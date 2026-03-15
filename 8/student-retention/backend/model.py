import pandas as pd
import numpy as np
import pickle
import os
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
import xgboost as xgb
import lightgbm as lgb
from generate_data import generate_dataset

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'best_model.pkl')
CATEGORICAL = ['gender', 'major']
NUMERICAL = ['gpa','attendance','lms_logins','assignments_submitted','financial_aid',
             'tuition_balance','part_time_job','age','year','prev_failures',
             'extracurricular','mental_health_visits','distance_from_campus']
FEATURE_COLS = NUMERICAL + CATEGORICAL

def build_preprocessor():
    return ColumnTransformer([
        ('num', StandardScaler(), NUMERICAL),
        ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), CATEGORICAL)
    ])

def get_real_students_df():
    try:
        from pymongo import MongoClient
        import certifi
        MONGO_URI = "mongodb+srv://chegireddypravallikareddy_db_user:oNPMKXqIlCAlOchI@cluster0.3kcpk2h.mongodb.net/?appName=Cluster0"
        client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
        students = list(client['student_retention']['students'].find())
        if not students:
            return pd.DataFrame()
        rows = []
        for s in students:
            row = {col: s.get(col) for col in FEATURE_COLS if col in s}
            if len(row) == len(FEATURE_COLS):
                risk = (-1.5*row['gpa'] - 0.03*row['attendance'] - 0.02*row['lms_logins']
                        - 0.05*row['assignments_submitted'] + 0.0001*row['tuition_balance']
                        + 0.3*row['prev_failures'] + 0.2*row['part_time_job']
                        - 0.3*row['financial_aid'] + 0.01*row['mental_health_visits'])
                row['dropout'] = 1 if risk > -3.5 else 0
                rows.append(row)
        df = pd.DataFrame(rows)
        print(f"Loaded {len(df)} real students from MongoDB.")
        return df
    except Exception as e:
        print(f"Could not load real students: {e}")
        return pd.DataFrame()

def train_models():
    df_synth = generate_dataset()[FEATURE_COLS + ['dropout']]
    df_real = get_real_students_df()
    if not df_real.empty:
        df = pd.concat([df_synth, df_real], ignore_index=True)
        print(f"Training on {len(df_synth)} synthetic + {len(df_real)} real students.")
    else:
        df = df_synth
    X = df[FEATURE_COLS]
    y = df['dropout']
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    models = {
        'xgboost': xgb.XGBClassifier(n_estimators=200, max_depth=6, learning_rate=0.1,
                                      eval_metric='logloss', random_state=42, n_jobs=-1),
        'lightgbm': lgb.LGBMClassifier(n_estimators=200, max_depth=6, learning_rate=0.1,
                                        random_state=42, n_jobs=-1, verbose=-1),
        'random_forest': RandomForestClassifier(n_estimators=200, max_depth=10, random_state=42, n_jobs=-1),
    }
    results = {}
    best_auc = 0
    best_model_name = None
    best_pipeline = None
    trained_clfs = {}
    for name, clf in models.items():
        pipeline = Pipeline([('preprocessor', build_preprocessor()), ('classifier', clf)])
        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, y_prob)
        report = classification_report(y_test, y_pred, output_dict=True)
        cm = confusion_matrix(y_test, y_pred).tolist()
        results[name] = {
            'auc': round(auc, 4), 'accuracy': round(report['accuracy'], 4),
            'precision': round(report['1']['precision'], 4),
            'recall': round(report['1']['recall'], 4),
            'f1': round(report['1']['f1-score'], 4), 'confusion_matrix': cm
        }
        trained_clfs[name] = clf
        if auc > best_auc:
            best_auc = auc
            best_model_name = name
            best_pipeline = pipeline
        print(f"{name}: AUC={auc:.4f}, Accuracy={report['accuracy']:.4f}")

    # Ensemble: soft-voting across all 3 trained classifiers
    ensemble_clf = VotingClassifier(
        estimators=[(n, c) for n, c in trained_clfs.items()],
        voting='soft'
    )
    ensemble_pipeline = Pipeline([('preprocessor', build_preprocessor()), ('classifier', ensemble_clf)])
    ensemble_pipeline.fit(X_train, y_train)
    y_pred_e = ensemble_pipeline.predict(X_test)
    y_prob_e = ensemble_pipeline.predict_proba(X_test)[:, 1]
    auc_e = roc_auc_score(y_test, y_prob_e)
    report_e = classification_report(y_test, y_pred_e, output_dict=True)
    cm_e = confusion_matrix(y_test, y_pred_e).tolist()
    results['ensemble'] = {
        'auc': round(auc_e, 4), 'accuracy': round(report_e['accuracy'], 4),
        'precision': round(report_e['1']['precision'], 4),
        'recall': round(report_e['1']['recall'], 4),
        'f1': round(report_e['1']['f1-score'], 4), 'confusion_matrix': cm_e
    }
    print(f"ensemble: AUC={auc_e:.4f}, Accuracy={report_e['accuracy']:.4f}")
    if auc_e > best_auc:
        best_auc = auc_e
        best_model_name = 'ensemble'
        best_pipeline = ensemble_pipeline

    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(best_pipeline, f)

    # Feature importance: use first base estimator if ensemble wins
    if best_model_name == 'ensemble':
        clf_for_imp = list(trained_clfs.values())[0]
    else:
        clf_for_imp = best_pipeline.named_steps['classifier']
    cat_features = best_pipeline.named_steps['preprocessor'].named_transformers_['cat'].get_feature_names_out(CATEGORICAL).tolist()
    feature_names = NUMERICAL + cat_features
    importances = clf_for_imp.feature_importances_
    feat_imp = sorted(zip(feature_names, importances.tolist()), key=lambda x: x[1], reverse=True)[:10]
    print(f"\nBest model: {best_model_name} (AUC={best_auc:.4f})")
    return results, feat_imp, best_model_name

def load_model():
    with open(MODEL_PATH, 'rb') as f:
        return pickle.load(f)

def predict_student(data: dict):
    model = load_model()
    row = {col: data[col] for col in FEATURE_COLS if col in data}
    df = pd.DataFrame([row])
    prob = float(model.predict_proba(df)[0][1])
    pred = int(model.predict(df)[0])
    risk_level = 'High' if prob >= 0.65 else 'Medium' if prob >= 0.35 else 'Low'
    return {
        'dropout_probability': round(prob, 4), 'at_risk': bool(pred), 'risk_level': risk_level,
        'recommendations': get_recommendations(data, prob), 'explanation': get_explanation(data, prob),
        'career': get_career(data), 'learning_path': get_learning_path(data),
        'warnings': get_warnings(data), 'financial_support': get_financial_support(data)
    }

def get_explanation(data, prob):
    reasons = []
    gpa=data.get('gpa',4); att=data.get('attendance',100); lms=data.get('lms_logins',30)
    asn=data.get('assignments_submitted',20); bal=data.get('tuition_balance',0); fail=data.get('prev_failures',0)
    if gpa<1.5: reasons.append({'factor':'GPA','value':f'{gpa:.2f}','impact':'Very High','detail':'GPA critically low (< 1.5)'})
    elif gpa<2.0: reasons.append({'factor':'GPA','value':f'{gpa:.2f}','impact':'High','detail':'GPA below passing threshold'})
    elif gpa<2.5: reasons.append({'factor':'GPA','value':f'{gpa:.2f}','impact':'Medium','detail':'GPA below average'})
    if att<50: reasons.append({'factor':'Attendance','value':f'{att:.1f}%','impact':'Very High','detail':'Attendance critically low'})
    elif att<65: reasons.append({'factor':'Attendance','value':f'{att:.1f}%','impact':'High','detail':'Attendance below 65%'})
    elif att<75: reasons.append({'factor':'Attendance','value':f'{att:.1f}%','impact':'Medium','detail':'Attendance below 75%'})
    if lms<5: reasons.append({'factor':'LMS Activity','value':f'{lms} logins','impact':'High','detail':'Very low LMS engagement'})
    elif lms<15: reasons.append({'factor':'LMS Activity','value':f'{lms} logins','impact':'Medium','detail':'Below average LMS usage'})
    if asn<8: reasons.append({'factor':'Assignments','value':f'{asn}/20','impact':'High','detail':'Less than 40% submitted'})
    elif asn<14: reasons.append({'factor':'Assignments','value':f'{asn}/20','impact':'Medium','detail':'Below average submissions'})
    if bal>8000: reasons.append({'factor':'Tuition Balance','value':f'${bal:,.0f}','impact':'High','detail':'High outstanding balance'})
    elif bal>5000: reasons.append({'factor':'Tuition Balance','value':f'${bal:,.0f}','impact':'Medium','detail':'Significant balance'})
    if fail>=3: reasons.append({'factor':'Previous Failures','value':str(fail),'impact':'High','detail':'Multiple course failures'})
    elif fail>=2: reasons.append({'factor':'Previous Failures','value':str(fail),'impact':'Medium','detail':'Prior failures on record'})
    if not reasons: reasons.append({'factor':'Overall','value':f'{round(prob*100)}%','impact':'Low','detail':'No major risk factors'})
    return reasons

def get_recommendations(data, prob):
    recs = []
    if data.get('gpa',4)<2.0:
        recs.append('Enroll in academic tutoring — GPA needs immediate attention.')
        recs.append('Complete all pending assignments to recover grades.')
    if data.get('attendance',100)<65:
        recs.append('Attendance is critically low — contact your academic advisor.')
    if data.get('lms_logins',30)<10:
        recs.append('Spend at least 1 hour daily on LMS course materials.')
    if data.get('tuition_balance',0)>5000:
        recs.append('Apply for scholarship or financial aid to reduce tuition burden.')
    if data.get('prev_failures',0)>=2:
        recs.append('Schedule academic counseling for better course planning.')
    if data.get('mental_health_visits',0)>=3:
        recs.append('Mental health support resources are available on campus.')
    if data.get('assignments_submitted',20)<10:
        recs.append('Submit all pending assignments — contact professors for extensions.')
    if prob>=0.65:
        recs.append('Immediate intervention recommended — schedule an advisor meeting this week.')
    if not recs:
        recs.append('Student is on track. Keep up the great work and continue monitoring.')
    return recs

def get_career(data):
    gpa = data.get('gpa',0)
    if gpa>=3.5: return {'recommended_paths':['Data Science','Software Engineering','Research & Academia'],'suggested_skills':['Python','Machine Learning','Statistics','Research Methods']}
    elif gpa>=3.0: return {'recommended_paths':['Web Development','Product Management','Business Analytics'],'suggested_skills':['JavaScript','React','SQL','Project Management']}
    elif gpa>=2.5: return {'recommended_paths':['IT Support','Digital Marketing','Quality Assurance'],'suggested_skills':['Communication','Excel','Basic Programming','Testing']}
    else: return {'recommended_paths':['Skill Training Programs','Internship Programs','Vocational Courses'],'suggested_skills':['Communication','Time Management','Basic Computer Skills']}

def get_learning_path(data):
    gpa=data.get('gpa',0); lms=data.get('lms_logins',30); asn=data.get('assignments_submitted',20)
    if gpa<2.5 or asn<12: return ['Review fundamental concepts in weak subjects','Complete all pending assignments','Join peer study groups','Attend extra tutorial sessions','Practice with past exam papers']
    elif lms<15: return ['Log into LMS daily and review course materials','Watch recorded lectures you have missed','Participate in online discussion forums','Complete all online quizzes','Explore supplementary resources']
    else: return ['Explore advanced topics in your major','Work on a capstone or research project','Apply for internship opportunities','Build a portfolio of your work','Prepare for industry certifications']

def get_warnings(data):
    warnings = []
    if data.get('attendance',100)<70: warnings.append({'type':'danger','msg':f"Attendance is {data['attendance']:.1f}% - below the 70% minimum"})
    if data.get('gpa',4)<2.0: warnings.append({'type':'danger','msg':f"GPA of {data['gpa']:.2f} is below the passing threshold of 2.0"})
    if data.get('lms_logins',30)<10: warnings.append({'type':'warning','msg':f"Only {data['lms_logins']} LMS logins this month"})
    if data.get('assignments_submitted',20)<10: warnings.append({'type':'warning','msg':f"Only {data['assignments_submitted']}/20 assignments submitted"})
    if data.get('tuition_balance',0)>5000: warnings.append({'type':'warning','msg':f"Outstanding tuition balance of ${data['tuition_balance']:,.0f}"})
    return warnings

def get_financial_support(data):
    if data.get('tuition_balance',0)>3000 or data.get('financial_aid',1)==0:
        return ['Apply for merit-based or need-based scholarship','Request a fee installment payment plan','Consult the financial counseling office','Explore government student loan options','Look for part-time campus employment']
    return []

if __name__ == '__main__':
    results, feat_imp, best = train_models()
    print("\nModel Results:", results)
    print("\nTop Features:", feat_imp)