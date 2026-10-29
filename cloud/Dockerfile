# Hosted container for the browser UI and Python API. Production requires the
# managed services and secrets described in cloud/README.md.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m pip install --no-cache-dir -r backend/requirements.txt

COPY frontend ./frontend
COPY backend ./backend
COPY migrations ./migrations

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV MY_LIBRARY_HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT', '8080') + '/api/health', timeout=3)"]
CMD ["python", "backend/server.py"]
