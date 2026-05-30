FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    WEASYPRINT_HOST=0.0.0.0 \
    WEASYPRINT_PORT=8010 \
    WEASYPRINT_ALLOWED_FILE_ROOT=/work

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fonts-dejavu-core \
    fonts-liberation \
    libharfbuzz-subset0 \
    libjpeg62-turbo \
    libopenjp2-7 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/weasyprint-poc

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8010

CMD ["python", "server.py"]
