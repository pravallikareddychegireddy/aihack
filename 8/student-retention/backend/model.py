import pandas as pd
import numpy as np
import pickle
import os
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
import xgboost as xgb
import lightgbm as lgb
from generate_data import generate_dataset

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'best_model.pkl')
CATEGORICAL = ['gender', 'major']
NUMERICAL = ['gpa','attendance','lms_logins','assignments_submitted','financial_aid',
             'tuition_balance','part_time_job','age','year','prev_failures',
             'extracurricular','mental_health_visits','distance_from_campus']
FEATURE_COLS = NUMERICAL + CATEGORICAL

# Unified risk score formula — same for synthetic and real students
def compute_risk_score(row):
    return (
        -1.5  * float(row.get('gpa', 2.8))
        - 0.03 * float(row.get('attendance', 75))
        - 0.02 * float(row.get('lms_logins', 30))
        - 0.05 * float(row.get('assignments_submitted', 15))
        + 0.0001 * float(row.get('tuition_balance', 2000))
        + 0.3  * float(row.get('prev_failures', 0))
        + 0.2  * float(row.get('part_time_job', 0))
        - 0.3  * float(row.get('financial_aid', 0))
        + 0.01 * float(row.get('mental_health_visits', 0))
    )

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
                rows.append(row)
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        # Use same percentile threshold as synthetic data for consistent labels
        scores = df.apply(compute_risk_score, axis=1)
        df['dropout'] = (scores > scores.quantile(0.70)).astype(int)
        print(f"Loaded {len(df)} real students from MongoDB. Dropout rate: {df['dropout'].mean():.2%}")
        return df
    except Exception as e:
        print(f"Could not load real students: {e}")
        return pd.DataFrame()

def train_models():
    df_synth = generate_dataset()[FEATURE_COLS + ['dropout']]
    df_real  = get_real_students_df()

    if not df_real.empty:
        df = pd.concat([df_synth, df_real], ignore_index=True)
        print(f"Training on {len(df_synth)} synthetic + {len(df_real)} real students.")
    else:
        df = df_synth

    X = df[FEATURE_COLS]
    y = df['dropout']

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # Tuned classifiers for higher accuracy
    clfs = {
        'xgboost': xgb.XGBClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, min_child_weight=3,
            eval_metric='logloss', random_state=42, n_jobs=-1
        ),
        'lightgbm': lgb.LGBMClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, min_child_samples=20,
            random_state=42, n_jobs=-1, verbose=-1
        ),
        'random_forest': RandomForestClassifier(
            n_estimators=300, max_depth=12, min_samples_leaf=5,
            max_features='sqrt', random_state=42, n_jobs=-1
        ),
    }

    results = {}
    best_auc = 0
    best_model_name = None
    best_pipeline = None
    fitted_pipelines = {}

    for name, clf in clfs.items():
        pipeline = Pipeline([('preprocessor', build_preprocessor()), ('classifier', clf)])
        pipeline.fit(X_train, y_train)
        y_pred  = pipeline.predict(X_test)
        y_prob  = pipeline.predict_proba(X_test)[:, 1]
        auc     = roc_auc_score(y_test, y_prob)
        report  = classification_report(y_test, y_pred, output_dict=True)
        cm      = confusion_matrix(y_test, y_pred).tolist()
        results[name] = {
            'auc':       round(auc, 4),
            'accuracy':  round(report['accuracy'], 4),
            'precision': round(report['1']['precision'], 4),
            'recall':    round(report['1']['recall'], 4),
            'f1':        round(report['1']['f1-score'], 4),
            'confusion_matrix': cm
        }
        fitted_pipelines[name] = pipeline
        if auc > best_auc:
            best_auc       = auc
            best_model_name = name
            best_pipeline  = pipeline
        print(f"{name}: AUC={auc:.4f}, Accuracy={report['accuracy']:.4f}")

    # ── Ensemble: soft-voting using already-fitted pipelines ──────────────────
    # Extract the fitted preprocessor from the best pipeline and transform once
    preprocessor = fitted_pipelines['xgboost'].named_steps['preprocessor']
    X_train_t = preprocessor.transform(X_train)
    X_test_t  = preprocessor.transform(X_test)

    # Build a VotingClassifier from the already-fitted base classifiers
    fitted_clfs = [(n, p.named_steps['classifier']) for n, p in fitted_pipelines.items()]
    ensemble_clf = VotingClassifier(estimators=fitted_clfs, voting='soft')
    # Trick: mark estimators as fitted so VotingClassifier skips re-fitting
    ensemble_clf.estimators_ = [clf for _, clf in fitted_clfs]
    ensemble_clf.le_ = type('LE', (), {'classes_': np.array([0, 1])})()
    ensemble_clf.classes_ = np.array([0, 1])

    y_prob_e = ensemble_clf.predict_proba(X_test_t)[:, 1]
    y_pred_e = (y_prob_e >= 0.5).astype(int)
    auc_e    = roc_auc_score(y_test, y_prob_e)
    report_e = classification_report(y_test, y_pred_e, output_dict=True)
    cm_e     = confusion_matrix(y_test, y_pred_e).tolist()
    results['ensemble'] = {
        'auc':       round(auc_e, 4),
        'accuracy':  round(report_e['accuracy'], 4),
        'precision': round(report_e['1']['precision'], 4),
        'recall':    round(report_e['1']['recall'], 4),
        'f1':        round(report_e['1']['f1-score'], 4),
        'confusion_matrix': cm_e
    }
    print(f"ensemble: AUC={auc_e:.4f}, Accuracy={report_e['accuracy']:.4f}")

    # Save ensemble as a full pipeline wrapping the best preprocessor
    if auc_e > best_auc:
        best_auc        = auc_e
        best_model_name = 'ensemble'
        # Wrap ensemble with the fitted preprocessor into a saveable object
        best_pipeline   = _EnsemblePipeline(preprocessor, ensemble_clf)

    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(best_pipeline, f)

    # Feature importance from best individual model
    best_individual = max(
        [(n, results[n]['auc']) for n in ('xgboost','lightgbm','random_forest')],
        key=lambda x: x[1]
    )[0]
    imp_clf = fitted_pipelines[best_individual].named_steps['classifier']
    cat_features  = preprocessor.named_transformers_['cat'].get_feature_names_out(CATEGORICAL).tolist()
    feature_names = NUMERICAL + cat_features
    feat_imp = sorted(
        zip(feature_names, imp_clf.feature_importances_.tolist()),
        key=lambda x: x[1], reverse=True
    )[:10]

    print(f"\nBest model: {best_model_name} (AUC={best_auc:.4f})")
    return results, feat_imp, best_model_name


class _EnsemblePipeline:
    """Lightweight wrapper so the ensemble can be pickled and used like a sklearn Pipeline."""
    def __init__(self, preprocessor, voting_clf):
        self.preprocessor = preprocessor
        self.voting_clf   = voting_clf

    def predict(self, X):
        return self.voting_clf.predict(self.preprocessor.transform(X))

    def predict_proba(self, X):
        return self.voting_clf.predict_proba(self.preprocessor.transform(X))


def load_model():
    with open(MODEL_PATH, 'rb') as f:
        return pickle.load(f)

def predict_student(data: dict):
    model = load_model()
    row   = {col: data.get(col, 0) for col in FEATURE_COLS}
    df    = pd.DataFrame([row])
    prob  = float(model.predict_proba(df)[0][1])
    pred  = int(model.predict(df)[0])
    risk_level = 'High' if prob >= 0.65 else 'Medium' if prob >= 0.35 else 'Low'
    return {
        'dropout_probability': round(prob, 4),
        'at_risk':    bool(pred),
        'risk_level': risk_level,
        'recommendations':  get_recommendations(data, prob),
        'explanation':      get_explanation(data, prob),
        'career':           get_career(data),
        'learning_path':    get_learning_path(data),
        'warnings':         get_warnings(data),
        'financial_support': get_financial_support(data)
    }

def get_explanation(data, prob):
    reasons = []
    gpa  = data.get('gpa', 4);   att  = data.get('attendance', 100)
    lms  = data.get('lms_logins', 30); asn = data.get('assignments_submitted', 20)
    bal  = data.get('tuition_balance', 0); fail = data.get('prev_failures', 0)
    if gpa < 1.5:   reasons.append({'factor':'GPA','value':f'{gpa:.2f}','impact':'Very High','detail':'GPA critically low (< 1.5)'})
    elif gpa < 2.0: reasons.append({'factor':'GPA','value':f'{gpa:.2f}','impact':'High','detail':'GPA below passing threshold'})
    elif gpa < 2.5: reasons.append({'factor':'GPA','value':f'{gpa:.2f}','impact':'Medium','detail':'GPA below average'})
    if att < 50:    reasons.append({'factor':'Attendance','value':f'{att:.1f}%','impact':'Very High','detail':'Attendance critically low'})
    elif att < 65:  reasons.append({'factor':'Attendance','value':f'{att:.1f}%','impact':'High','detail':'Attendance below 65%'})
    elif att < 75:  reasons.append({'factor':'Attendance','value':f'{att:.1f}%','impact':'Medium','detail':'Attendance below 75%'})
    if lms < 5:     reasons.append({'factor':'LMS Activity','value':f'{lms} logins','impact':'High','detail':'Very low LMS engagement'})
    elif lms < 15:  reasons.append({'factor':'LMS Activity','value':f'{lms} logins','impact':'Medium','detail':'Below average LMS usage'})
    if asn < 8:     reasons.append({'factor':'Assignments','value':f'{asn}/20','impact':'High','detail':'Less than 40% submitted'})
    elif asn < 14:  reasons.append({'factor':'Assignments','value':f'{asn}/20','impact':'Medium','detail':'Below average submissions'})
    if bal > 8000:  reasons.append({'factor':'Tuition Balance','value':f'${bal:,.0f}','impact':'High','detail':'High outstanding balance'})
    elif bal > 5000: reasons.append({'factor':'Tuition Balance','value':f'${bal:,.0f}','impact':'Medium','detail':'Significant balance'})
    if fail >= 3:   reasons.append({'factor':'Previous Failures','value':str(fail),'impact':'High','detail':'Multiple course failures'})
    elif fail >= 2: reasons.append({'factor':'Previous Failures','value':str(fail),'impact':'Medium','detail':'Prior failures on record'})
    if not reasons: reasons.append({'factor':'Overall','value':f'{round(prob*100)}%','impact':'Low','detail':'No major risk factors'})
    return reasons

def get_recommendations(data, prob):
    recs = []
    if data.get('gpa', 4) < 2.0:
        recs.append('Enroll in academic tutoring — GPA needs immediate attention.')
        recs.append('Complete all pending assignments to recover grades.')
    if data.get('attendance', 100) < 65:
        recs.append('Attendance is critically low — contact your academic advisor.')
    if data.get('lms_logins', 30) < 10:
        recs.append('Spend at least 1 hour daily on LMS course materials.')
    if data.get('tuition_balance', 0) > 5000:
        recs.append('Apply for scholarship or financial aid to reduce tuition burden.')
    if data.get('prev_failures', 0) >= 2:
        recs.append('Schedule academic counseling for better course planning.')
    if data.get('mental_health_visits', 0) >= 3:
        recs.append('Mental health support resources are available on campus.')
    if data.get('assignments_submitted', 20) < 10:
        recs.append('Submit all pending assignments — contact professors for extensions.')
    if prob >= 0.65:
        recs.append('Immediate intervention recommended — schedule an advisor meeting this week.')
    if not recs:
        recs.append('Student is on track. Keep up the great work and continue monitoring.')
    return recs

def get_career(data):
    gpa = data.get('gpa', 0)
    if gpa >= 3.5:   return {'recommended_paths':['Data Science','Software Engineering','Research & Academia'],'suggested_skills':['Python','Machine Learning','Statistics','Research Methods']}
    elif gpa >= 3.0: return {'recommended_paths':['Web Development','Product Management','Business Analytics'],'suggested_skills':['JavaScript','React','SQL','Project Management']}
    elif gpa >= 2.5: return {'recommended_paths':['IT Support','Digital Marketing','Quality Assurance'],'suggested_skills':['Communication','Excel','Basic Programming','Testing']}
    else:            return {'recommended_paths':['Skill Training Programs','Internship Programs','Vocational Courses'],'suggested_skills':['Communication','Time Management','Basic Computer Skills']}

def get_learning_path(data):
    gpa = data.get('gpa', 0); lms = data.get('lms_logins', 30); asn = data.get('assignments_submitted', 20)
    if gpa < 2.5 or asn < 12:
        return ['Review fundamental concepts in weak subjects','Complete all pending assignments','Join peer study groups','Attend extra tutorial sessions','Practice with past exam papers']
    elif lms < 15:
        return ['Log into LMS daily and review course materials','Watch recorded lectures you have missed','Participate in online discussion forums','Complete all online quizzes','Explore supplementary resources']
    else:
        return ['Explore advanced topics in your major','Work on a capstone or research project','Apply for internship opportunities','Build a portfolio of your work','Prepare for industry certifications']

def get_warnings(data):
    w = []
    if data.get('attendance', 100) < 70: w.append({'type':'danger','msg':f"Attendance is {data['attendance']:.1f}% - below the 70% minimum"})
    if data.get('gpa', 4) < 2.0:         w.append({'type':'danger','msg':f"GPA of {data['gpa']:.2f} is below the passing threshold of 2.0"})
    if data.get('lms_logins', 30) < 10:  w.append({'type':'warning','msg':f"Only {data['lms_logins']} LMS logins this month"})
    if data.get('assignments_submitted', 20) < 10: w.append({'type':'warning','msg':f"Only {data['assignments_submitted']}/20 assignments submitted"})
    if data.get('tuition_balance', 0) > 5000: w.append({'type':'warning','msg':f"Outstanding tuition balance of ${data['tuition_balance']:,.0f}"})
    return w

def get_financial_support(data):
    if data.get('tuition_balance', 0) > 3000 or data.get('financial_aid', 1) == 0:
        return ['Apply for merit-based or need-based scholarship','Request a fee installment payment plan','Consult the financial counseling office','Explore government student loan options','Look for part-time campus employment']
    return []

if __name__ == '__main__':
    results, feat_imp, best = train_models()
    print("\nModel Results:", results)
    print("\nTop Features:", feat_imp)
