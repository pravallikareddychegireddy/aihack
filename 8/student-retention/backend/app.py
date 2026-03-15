from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os, traceback, io
from pymongo import MongoClient
import certifi
from model import train_models, predict_student, MODEL_PATH
import pandas as pd

app = Flask(__name__)
app.secret_key = 'student_retention_secret_2024'
CORS(app)

FRONTEND = os.path.join(os.path.dirname(__file__), '..', 'frontend')
MONGO_URI = "mongodb+srv://chegireddypravallikareddy_db_user:oNPMKXqIlCAlOchI@cluster0.3kcpk2h.mongodb.net/?appName=Cluster0"
client = MongoClient(MONGO_URI, tlsCAFile=certifi.where())
db = client['student_retention']
students_col = db['students']
admins_col   = db['admins']

def serialize(doc):
    doc = dict(doc)
    doc['_id'] = str(doc['_id'])
    doc['id'] = doc.get('student_id', doc['_id'])
    return doc

def enrich(s):
    sc = dict(s)
    sc.pop('password', None)
    features = {k: v for k, v in sc.items() if k not in ('id','student_id','name','email','_id','role')}
    try:
        pred = predict_student(features)
        sc.update(pred)
    except Exception:
        sc.update({'risk_level':'Unknown','dropout_probability':0,'recommendations':[],'explanation':[],'warnings':[]})
    return sc

def next_student_id():
    last = students_col.find_one(sort=[('student_id', -1)])
    return (last['student_id'] + 1) if last else 1

@app.route('/')
def index():
    return send_from_directory(FRONTEND, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(FRONTEND, filename)

@app.route('/api/admin/register', methods=['POST'])
def admin_register():
    if admins_col.count_documents({}) > 0:
        return jsonify({'status':'error','message':'Admin already registered. Only one admin allowed.'}), 403
    data = request.get_json()
    username = data.get('username','').strip()
    password = data.get('password','').strip()
    name     = data.get('name','').strip()
    if not username or not password or not name:
        return jsonify({'status':'error','message':'Name, username and password are required'}), 400
    admins_col.insert_one({'username':username,'password':password,'name':name,'role':'admin'})
    return jsonify({'status':'success','message':'Admin account created successfully'})

@app.route('/api/admin/exists', methods=['GET'])
def admin_exists():
    return jsonify({'exists': admins_col.count_documents({}) > 0})

@app.route('/api/login', methods=['POST'])
def login():
    data     = request.get_json()
    username = data.get('username','').strip()
    password = data.get('password','').strip()
    role     = data.get('role','student')
    if role == 'admin':
        admin = admins_col.find_one({'username':username,'password':password})
        if admin:
            return jsonify({'status':'success','role':'admin','name':admin.get('name',username)})
        return jsonify({'status':'error','message':'Invalid admin credentials'}), 401
    student = students_col.find_one({'email':username,'password':password})
    if student:
        enriched = enrich(serialize(student))
        resp = {'status':'success','role':'student','id':student['student_id'],'name':student['name']}
        # If high risk, add warning message
        if enriched.get('risk_level') == 'High':
            resp['warning'] = 'Your academic performance is very low due to these reasons: ' + \
                ', '.join([e['factor'] for e in enriched.get('explanation',[])])
            resp['explanation'] = enriched.get('explanation',[])
        return jsonify(resp)
    return jsonify({'status':'error','message':'Invalid student credentials'}), 401

@app.route('/api/signup', methods=['POST'])
def signup():
    data     = request.get_json()
    name     = data.get('name','').strip()
    email    = data.get('email','').strip().lower()
    password = data.get('password','').strip()
    if not name or not email or not password:
        return jsonify({'status':'error','message':'Name, email and password are required'}), 400
    if students_col.find_one({'email':email}):
        return jsonify({'status':'error','message':'Email already registered'}), 409
    sid = next_student_id()
    doc = {
        'student_id':sid,'name':name,'email':email,'password':password,
        'gpa':0.0,'attendance':0.0,'lms_logins':0,'assignments_submitted':0,
        'financial_aid':0,'tuition_balance':0.0,'part_time_job':0,
        'age':18,'gender':'M','major':'Engineering','year':1,
        'prev_failures':0,'extracurricular':0,'mental_health_visits':0,'distance_from_campus':0.0
    }
    students_col.insert_one(doc)
    return jsonify({'status':'success','id':sid,'name':name})

@app.route('/api/admin/students', methods=['GET'])
def get_all_students():
    students = list(students_col.find())
    model_ready = os.path.exists(MODEL_PATH)
    result = [enrich(serialize(s)) if model_ready else serialize(s) for s in students]
    return jsonify({'status':'success','students':result})

@app.route('/api/admin/students', methods=['POST'])
def add_student():
    data = request.get_json()
    data['student_id'] = next_student_id()
    if 'password' not in data:
        data['password'] = 'student123'
    students_col.insert_one(data)
    return jsonify({'status':'success','id':data['student_id']})

@app.route('/api/admin/students/<int:sid>', methods=['PUT'])
def update_student(sid):
    data = request.get_json()
    data.pop('_id', None)
    result = students_col.update_one({'student_id':sid},{'$set':data})
    if result.matched_count == 0:
        return jsonify({'status':'error','message':'Student not found'}), 404
    return jsonify({'status':'success'})

@app.route('/api/admin/students/<int:sid>', methods=['DELETE'])
def delete_student(sid):
    students_col.delete_one({'student_id':sid})
    return jsonify({'status':'success'})

@app.route('/api/admin/analytics', methods=['GET'])
def analytics():
    if not os.path.exists(MODEL_PATH):
        return jsonify({'status':'error','message':'Model not trained yet'}), 400
    students = list(students_col.find())
    if not students:
        return jsonify({'status':'success','data':{}})
    predictions = []
    for s in students:
        try: predictions.append(enrich(serialize(s)))
        except Exception: pass
    total = len(predictions)
    if total == 0:
        return jsonify({'status':'success','data':{}})
    high   = sum(1 for p in predictions if p.get('risk_level')=='High')
    medium = sum(1 for p in predictions if p.get('risk_level')=='Medium')
    low    = sum(1 for p in predictions if p.get('risk_level')=='Low')
    avg_gpa = round(sum(p['gpa'] for p in predictions)/total,2)
    avg_att = round(sum(p['attendance'] for p in predictions)/total,1)
    avg_lms = round(sum(p['lms_logins'] for p in predictions)/total,1)
    from collections import defaultdict
    major_gpa = defaultdict(list)
    for p in predictions: major_gpa[p['major']].append(p['gpa'])
    gpa_by_major = {m:round(sum(v)/len(v),2) for m,v in major_gpa.items()}
    att_dist = {'<60':0,'60-75':0,'75-90':0,'>90':0}
    for p in predictions:
        a=p['attendance']
        if a<60: att_dist['<60']+=1
        elif a<75: att_dist['60-75']+=1
        elif a<90: att_dist['75-90']+=1
        else: att_dist['>90']+=1
    lms_dist = {'<10':0,'10-25':0,'25-40':0,'>40':0}
    for p in predictions:
        l=p['lms_logins']
        if l<10: lms_dist['<10']+=1
        elif l<25: lms_dist['10-25']+=1
        elif l<40: lms_dist['25-40']+=1
        else: lms_dist['>40']+=1
    fin_risk = sum(1 for p in predictions if p.get('tuition_balance',0)>5000)
    at_risk_list = [{'id':p['id'],'name':p['name'],'risk_level':p['risk_level'],
        'dropout_probability':p.get('dropout_probability',0),'gpa':p['gpa'],'attendance':p['attendance']}
        for p in predictions if p.get('at_risk')]
    year_dist = defaultdict(int)
    for p in predictions: year_dist[f"Year {p['year']}"]+=1
    return jsonify({'status':'success','data':{
        'total':total,'high_risk':high,'medium_risk':medium,'low_risk':low,
        'avg_gpa':avg_gpa,'avg_attendance':avg_att,'avg_lms':avg_lms,
        'gpa_by_major':gpa_by_major,'attendance_distribution':att_dist,
        'lms_distribution':lms_dist,'financial_risk_count':fin_risk,
        'at_risk_student_list':at_risk_list,'year_distribution':dict(year_dist)
    }})

@app.route('/api/student/<int:sid>', methods=['GET'])
def get_student(sid):
    s = students_col.find_one({'student_id':sid})
    if not s:
        return jsonify({'status':'error','message':'Student not found'}), 404
    s = serialize(s)
    if os.path.exists(MODEL_PATH):
        s = enrich(s)
    s.pop('password', None)
    return jsonify({'status':'success','student':s})

@app.route('/api/train', methods=['POST'])
def train():
    try:
        results, feat_imp, best = train_models()
        return jsonify({'status':'success','results':results,'feature_importance':feat_imp,'best_model':best})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'status':'error','message':str(e)}), 500

@app.route('/api/predict', methods=['POST'])
def predict():
    try:
        if not os.path.exists(MODEL_PATH):
            return jsonify({'status':'error','message':'Model not trained yet'}), 400
        result = predict_student(request.get_json())
        return jsonify({'status':'success',**result})
    except Exception as e:
        traceback.print_exc()
        return jsonify({'status':'error','message':str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status':'ok','model_ready':os.path.exists(MODEL_PATH)})


@app.route('/api/student/<int:sid>/update', methods=['PUT'])
def update_student_profile(sid):
    data = request.get_json()
    data.pop('_id', None)
    data.pop('password', None)
    result = students_col.update_one({'student_id': sid}, {'$set': data})
    if result.matched_count == 0:
        return jsonify({'status': 'error', 'message': 'Student not found'}), 404
    return jsonify({'status': 'success'})

@app.route('/api/admin/upload_csv', methods=['POST'])
def upload_csv():
    if 'file' not in request.files:
        return jsonify({'status':'error','message':'No file uploaded'}), 400
    file = request.files['file']
    try:
        df = pd.read_csv(io.StringIO(file.stream.read().decode('utf-8')))
    except Exception as e:
        return jsonify({'status':'error','message':'Invalid CSV format'}), 400
    required_fields = ['name','email','gpa','attendance','lms_logins','assignments_submitted','financial_aid','tuition_balance','part_time_job','age','gender','major','year','prev_failures','extracurricular','mental_health_visits','distance_from_campus']
    missing = [f for f in required_fields if f not in df.columns]
    if missing:
        return jsonify({'status':'error','message':'Missing fields: ' + ', '.join(missing)}), 400
    imported = 0
    for _, row in df.iterrows():
        email = str(row['email']).strip().lower()
        if students_col.find_one({'email':email}):
            continue
        doc = {f: row[f] for f in required_fields}
        doc['student_id'] = next_student_id()
        doc['password'] = 'student123'
        students_col.insert_one(doc)
        imported += 1
    return jsonify({'status':'success','imported':imported})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)