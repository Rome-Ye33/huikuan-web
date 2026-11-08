# 回款管理（前端）

财务每天录到账、拆分到车、生成报款文字；每周或每月导银行流水自动对账。后端是 Supabase 项目 `huikuan-system`（伦敦），表、视图、函数和权限都在数据库里，SQL 文件在项目资料 `supabase/` 目录。

## 页面

| 菜单 | 谁能用 | 做什么 |
| --- | --- | --- |
| 到账录入 | 管理员、财务 | 录一笔到账（账户、金额、汇率、凭证），拆到一台或多台车，保存后出报款文字 |
| 报款 | 管理员、财务 | 待发群的报款文字，复制后发群，再标记已发；改过已发的会提示“补发更正” |
| 车辆台账 | 所有人（业务员只看自己名下） | 合同价、已到账、余额、回款状态；可录期初已到账、优惠折让；导出 Excel |
| 银行对账 | 管理员、财务 | 导入银行流水（CSV/Excel），按“同账户、同金额、日期差 3 天内”自动配对；处理“银行有、没人报”和“录了、银行查不到” |
| 基础资料 | 管理员、财务 | 汇率、客户、业务员、收款账户、款项性质 |
| 用户与权限 | 管理员 | 邀请名单、改角色、停用离职的人 |

## 本地运行

```bash
npm install
npm run dev        # 开发
npm run build      # 打包到 dist/，是纯静态文件，放到任何静态网站托管都能用
```

`.env` 里是 Supabase 地址和 publishable key，这两个本来就是给浏览器用的，公开无妨。**不要**把 service_role key 或数据库密码放进前端。

## 发布

`.github/workflows/deploy.yml` 会在推到 `main` 时自动打包并发布到 GitHub Pages（仓库 Settings → Pages → Source 选 GitHub Actions）。用的是 HashRouter 和相对路径，放在子目录下也能用。

## 技术

Vite + React 19 + TypeScript + Ant Design 6 + supabase-js。数据库类型在 `src/lib/database.types.ts`，改了数据库后要重新生成。
