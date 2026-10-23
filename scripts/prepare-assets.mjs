// 构建前准备资源：src/assets/wechat-card.png 是**作者私人微信名片**，不进 git。
// 本地存在真名片 → 原样使用；不存在（别人 clone）→ 用占位图顶上，构建不报错。
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const real = join(root, "src/assets/wechat-card.png");
const placeholder = join(root, "src/assets/wechat-card.placeholder.png");
// 侧栏缩略图用的二维码方图，同样是作者私人资源，不进 git。
const qrReal = join(root, "src/assets/wechat-qr.png");
const qrPlaceholder = join(root, "src/assets/wechat-qr.placeholder.png");

if (!existsSync(real)) {
  copyFileSync(placeholder, real);
  console.log("[prepare-assets] 未找到私人名片，已用占位图代替（把 src/assets/wechat-card.png 换成你自己的名片即可）");
}
if (!existsSync(qrReal)) {
  copyFileSync(existsSync(qrPlaceholder) ? qrPlaceholder : placeholder, qrReal);
  console.log("[prepare-assets] 未找到二维码方图，已用占位图代替（src/assets/wechat-qr.png）");
}
