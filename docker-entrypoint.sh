#!/bin/sh
# Sửa quyền trên ổ đĩa GẮN LÚC CHẠY, rồi mới hạ quyền xuống user thường.
#
# Vì sao cần: Dockerfile chown /data lúc BUILD, nhưng Fly (và `docker run -v`)
# gắn ổ đĩa đè lên /data lúc CHẠY. Thư mục gốc của một ổ đĩa mới thuộc
# root:root, nên tiến trình chạy bằng user 'node' không tạo nổi file nào — app
# chết ngay lần đầu mở sổ với "unable to open database file", và người dùng chỉ
# thấy một trang trắng vì máy chủ không bao giờ lên.
#
# Vào bằng root chỉ để làm đúng việc này, rồi exec sang 'node'. App không bao
# giờ chạy bằng root.
set -e

if [ "$(id -u)" = "0" ]; then
  for d in "${FINMATE_DATA_DIR:-/data}" "${FINMATE_BACKUP_DIR:-/data/backups}"; do
    mkdir -p "$d"
    # Chỉ đổi quyền khi thư mục chưa thuộc 'node': sổ đã có vài nghìn file thì
    # chown -R mỗi lần khởi động là phí thời gian vô ích.
    if [ "$(stat -c %u "$d")" != "$(id -u node)" ]; then
      echo "[finmate] nhận ổ đĩa mới ở $d, đang chuyển quyền cho user node…"
      chown -R node:node "$d"
    fi
  done
  exec su-exec node "$@"
fi

exec "$@"
