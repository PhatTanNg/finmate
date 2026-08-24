# FinMate — một tiến trình duy nhất phục vụ cả API lẫn giao diện.
#
# Cần Node >= 22.5 vì app dùng `node:sqlite` có sẵn trong Node, không cài
# thêm driver SQLite nào.

FROM node:22-alpine AS build
WORKDIR /app

# Cài dependency trước, tách khỏi source để tận dụng cache của Docker.
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build --workspace web


FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production

# Chỉ cần dependency của server; toàn bộ frontend đã thành file tĩnh.
COPY package.json package-lock.json* ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server && npm cache clean --force

COPY server/src server/src
COPY --from=build /app/web/dist web/dist

# Dữ liệu phải nằm trên volume, nếu không container chết là mất sạch sổ sách.
ENV FINMATE_DB=/data/finmate.db
ENV FINMATE_BACKUP_DIR=/data/backups
ENV FINMATE_HOST=0.0.0.0
ENV PORT=4000
VOLUME ["/data"]

# Không chạy bằng root.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
