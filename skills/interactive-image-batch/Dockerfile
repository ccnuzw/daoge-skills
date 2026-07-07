FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV DAOGE_OUTPUT_DIR=/workspace
ENV PORT=7860

EXPOSE 7860
VOLUME ["/workspace"]

CMD ["sh", "-c", "node scripts/daoge.js open --output-dir \"$DAOGE_OUTPUT_DIR\" --host 0.0.0.0 --port \"$PORT\""]
