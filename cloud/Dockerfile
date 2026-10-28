# Staging container only. It makes the front end and Python API portable, but
# a public multi-user launch must first replace the local JSON/upload storage
# with the Postgres/object-storage adapters documented in cloud/README.md.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m pip install --no-cache-dir -r backend/requirements.txt

COPY frontend ./frontend
COPY backend ./backend

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV MY_LIBRARY_HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
CMD ["python", "backend/server.py"]
