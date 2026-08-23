/** Tạo bản sao lưu thủ công: `npm run backup` */
import { createBackup, listBackups, BACKUP_DIR } from '../services/backup.js';

const b = createBackup();
console.log(`[finmate] đã sao lưu: ${b.path} (${Math.round(b.size / 1024)} KB)`);
if (b.pruned) console.log(`[finmate] đã xoá ${b.pruned} bản cũ`);
console.log(`[finmate] hiện có ${listBackups().length} bản trong ${BACKUP_DIR}`);
