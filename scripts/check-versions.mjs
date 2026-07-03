// 版本一致性闸门：package.json 与 app.json（expo.version）必须一致，
// 否则商店提交的版本号与工程版本悄悄脱节。随 `npm run check` 运行。
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));

if (pkg.version !== app.expo.version) {
  console.error(
    `version mismatch: package.json = ${pkg.version}, app.json expo.version = ${app.expo.version}`,
  );
  process.exit(1);
}
console.log(`version ok: ${pkg.version}`);
