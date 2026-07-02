// 示例库：按语言取用。示例是 Flow 数据（知识），不是 UI 文案，
// 因此每种语言各有一份内容等价、id 相同的定义——运行记录与打卡按 id 关联，切换语言不丢数据。

import { type Flow } from '../domain/types';
import { type Locale } from '../i18n/locale';
import { coffeeFlow, coffeeFlowEn } from './coffee';
import { medicationFlow, medicationFlowEn } from './medication';

export function examplesFor(locale: Locale): Flow[] {
  return locale === 'zh' ? [coffeeFlow, medicationFlow] : [coffeeFlowEn, medicationFlowEn];
}
