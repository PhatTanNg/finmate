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
#
# FINMATE_DATA_DIR là thứ dễ quên nhất và hậu quả nặng nhất: danh bạ tài khoản
# và sổ RIÊNG của từng người dùng nằm dưới thư mục này. Không đặt thì chúng rơi
# vào /app/server/data ngay trong container — mỗi lần deploy lại là mọi người
# dùng mất sạch sổ, trong khi /data/finmate.db vẫn còn nên nhìn qua tưởng ổn.
ENV FINMATE_DATA_DIR=/data
ENV FINMATE_DB=/data/finmate.db
ENV FINMATE_BACKUP_DIR=/data/backups
ENV FINMATE_HOST=0.0.0.0
ENV PORT=4000
VOLUME ["/data"]

# Không chạy bằng root — nhưng cũng không thể đặt USER node ở đây: ổ đĩa gắn vào
# /data lúc CHẠY thuộc root, mà một tiến trình 'node' thì không tự sửa quyền cho
# mình được. Vào bằng root, entrypoint sửa quyền đúng thư mục đó rồi mới hạ
# quyền xuống 'node' (su-exec) trước khi chạy app.
RUN apk add --no-cache su-exec && mkdir -p /data && chown -R node:node /data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
