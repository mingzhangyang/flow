// 设备时区适配器：偏移按「所询问的那个时刻」取值，因此跨 DST 切换日也正确。
// 这是纯逻辑与宿主环境之间唯一的时区注入点——runtime 本身只接收 TimeZone（E3）；
// 应用侧（UI）在调用时注入本适配器，测试注入 fixedTimeZone 或自构造的阶跃时区。

import type { TimeZone } from './clock';

export const systemTimeZone: TimeZone = {
  // Date#getTimezoneOffset 返回“UTC − 本地”（西为正），取反得“本地 − UTC”（东为正）。
  offsetAt: (at) => -new Date(at).getTimezoneOffset(),
};
