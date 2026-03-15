import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder

np.random.seed(42)
N = 10000

def generate_dataset():
    gpa = np.random.normal(2.8, 0.7, N).clip(0, 4.0)
    attendance = np.random.normal(75, 15, N).clip(0, 100)
    lms_logins = np.random.poisson(30, N)
    assignments_submitted = np.random.binomial(20, 0.75, N)
    financial_aid = np.random.choice([0, 1], N, p=[0.4, 0.6])
    tuition_balance = np.random.exponential(2000, N).clip(0, 15000)
    part_time_job = np.random.choice([0, 1], N, p=[0.55, 0.45])
    age = np.random.randint(17, 35, N)
    gender = np.random.choice(['M', 'F', 'Other'], N, p=[0.48, 0.48, 0.04])
    major = np.random.choice(['Engineering', 'Business', 'Arts', 'Science', 'Education'], N)
    year = np.random.choice([1, 2, 3, 4], N)
    prev_failures = np.random.poisson(0.5, N).clip(0, 5)
    extracurricular = np.random.choice([0, 1], N, p=[0.6, 0.4])
    mental_health_visits = np.random.poisson(1, N).clip(0, 10)
    distance_from_campus = np.random.exponential(15, N).clip(0, 100)

    # NEW: History fields for trends (3 months past data)
    past_gpa = [np.random.normal(g, 0.2, 3).clip(0, 4.0).round(2).tolist() for g in gpa]
    past_attendance = [np.random.normal(a, 5, 3).clip(0, 100).round(1).tolist() for a in attendance]
    past_lms = [np.random.poisson(25, 3).tolist() for _ in range(N)]

    # Risk score formula
    risk_score = (
        -1.5 * gpa
        - 0.03 * attendance
        - 0.02 * lms_logins
        - 0.05 * assignments_submitted
        + 0.0001 * tuition_balance
        + 0.3 * prev_failures
        + 0.2 * part_time_job
        - 0.3 * financial_aid
        + 0.01 * mental_health_visits
        + np.random.normal(0, 0.5, N)
    )

    dropout = (risk_score > np.percentile(risk_score, 70)).astype(int)

    df = pd.DataFrame({
        'gpa': gpa.round(2),
        'attendance': attendance.round(1),
        'lms_logins': lms_logins,
        'assignments_submitted': assignments_submitted,
        'financial_aid': financial_aid,
        'tuition_balance': tuition_balance.round(2),
        'part_time_job': part_time_job,
        'age': age,
        'gender': gender,
        'major': major,
        'year': year,
        'prev_failures': prev_failures,
        'extracurricular': extracurricular,
        'mental_health_visits': mental_health_visits,
        'distance_from_campus': distance_from_campus.round(1),
        'past_gpa': past_gpa,
        'past_attendance': past_attendance,
        'past_lms_logins': past_lms,
        'dropout': dropout
    })
    return df

if __name__ == '__main__':
    df = generate_dataset()
    df.to_csv('student_data.csv', index=False)
    print(f"Dataset saved: {df.shape}, Dropout rate: {df['dropout'].mean():.2%}")

