FROM node:20-slim

# Install Python + pip for AKShare data collection
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY scripts/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt && rm /tmp/requirements.txt

WORKDIR /app

# Copy package files and install Node dependencies
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true

# Copy application code
COPY public/ ./public/
COPY src/ ./src/
COPY shared/ ./shared/
COPY tests/ ./tests/
COPY scripts/ ./scripts/

# Pre-collect limitup data (build time)
RUN mkdir -p .cache && \
    python scripts/fetch_limitup_akshare.py --days 21 --reset 2>/dev/null || true

# Expose port
EXPOSE 10000

# Start server
CMD ["node", "src/server.js"]
