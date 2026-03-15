# Student Retention App - Fix Render 404 Deployment Issue

## Plan Summary
Render deploys backend-only; frontend inaccessible. Fix: Copy frontend to backend/static during build, update paths.

## Steps to Complete (4/5) ✓
- [x] 1. Update render.yaml: rootDir: ., buildCommand copies frontend to backend/static, pip backend/reqs
- [x] 2. Update backend/app.py: FRONTEND path to os.path.join(BASE_DIR, 'static')
- [x] 3. Verify frontend files exist (app.js, index.html, style.css) and Procfile unchanged
- [x] 4. Test local: python backend/app.py, check http://localhost:5000 loads frontend + /api/health
- [ ] 5. Instruct user to git commit/push to trigger Render redeploy, verify live site
