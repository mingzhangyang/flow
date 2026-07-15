# Android keystore 备份手册（KeePassXC）

> 服务 [`docs/release.md`](./release.md) 中「keystore 丢失 = 永远无法更新已上架应用」的备份要求。
> 本项目凭据：EAS 云端托管，账号 `ideas-flow`，项目 `@ideas-flow/flow`，
> 构建凭据名 `Build Credentials EdrPA2S4Zz (default)`。

## 为什么不能只依赖「EAS 网页随时下载」

日常构建确实不需要本地副本——EAS 云端签名很省心。备份防的是**「随时下载」的前提失效**：

- **账号出问题**：忘记密码 + 丢失 2FA、邮箱失控、账号被盗或被封。
- **Expo 侧出问题**：服务调整、凭据功能收费墙变化，乃至公司停止运营。EAS 是商业服务，不是保险箱。
- **误操作**：控制台里删除凭据/项目是允许的操作，没有回收站。
- **网络环境**：需要它的那一刻 expo.dev 恰好访问不了。

概率低，但损失绝对：keystore 丢了，该包名下已安装用户**永远**收不到更新，只能换包名重新上架。
低概率 × 不可逆 = 值得一次性花十分钟对冲。宪章 C6 的道理同样适用于签名密钥：**平台可以换，密钥不应消失**。

**例外与边界**：若上 Google Play 且启用 Play App Signing（新应用默认），Google 持有真正的签名密钥，
EAS 这把只是上传密钥（丢了可走 Google 支持重置）。但国产商店与直接分发 APK 的渠道没有这层保护——
对本项目而言 keystore 仍是唯一签名密钥。

## 从 EAS 下载什么

网页控制台（交互式 `eas credentials` 在无 TTY 环境跑不了，见 release-status 的坑）：

1. 打开 https://expo.dev/accounts/ideas-flow/projects/flow/credentials → Android。
2. 下载 keystore（`.jks` 文件）。
3. 同页记下三组值：**Keystore password**、**Key alias**、**Key password**。

**`.jks` 绝不入 git 仓库。**

## 存入 KeePassXC

### 1. 建库（第一次用）

- 从 https://keepassxc.org 下载安装（Windows 版）。
- 「数据库 → 新建数据库」，设**主密码**——唯一需要记住的密码，丢了整库打不开，建议用一句长短语。
- 产物是一个 `.kdbx` 文件：整个密码库就是这一个加密文件（Argon2 + AES）。

### 2. 建条目存三组值

新建条目（Ctrl+N），一条记录放齐，杜绝日后「哪个密码配哪个」的混乱：

| 位置 | 内容 |
|---|---|
| 标题 | `Zhunshi Android keystore (EAS)` |
| 密码字段 | Keystore password |
| 网址 | `https://expo.dev/accounts/ideas-flow/projects/flow/credentials` |
| 备注 | 构建凭据名 `Build Credentials EdrPA2S4Zz (default)` |

再到条目编辑窗口「**高级**」页的「附加属性」加两条：

- `key-alias` → 别名值（不敏感，可不勾「保护」）
- `key-password` → key 密码（**勾「保护」**，显示为掩码）

### 3. 挂上 `.jks` 文件

同一条目「高级」页 →「附件」→ 添加，选中下载的 `.jks`。
文件会加密存进 `.kdbx`，与密码不分家。

### 4. 备份 `.kdbx` 本身

- `.kdbx` 是强加密文件，可放心复制到网盘/移动硬盘做**异地副本**——本地单份的密码库和没备份的 keystore 是同一种风险。
- 主密码与 `.kdbx` 分开存放（主密码在脑中，文件在云端；两者单独泄露都无害）。

## 完成判据

- [ ] `.jks` 已下载并作为附件存入 KeePassXC 条目
- [ ] 三组值（keystore 密码 / key alias / key 密码）在同一条目内
- [ ] `.kdbx` 至少有一份异地副本
- [ ] `.jks` 未出现在任何 git 仓库或未加密的云盘目录
