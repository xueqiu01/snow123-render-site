# Snow123 Split

这是已经拆分并补齐部署能力的 Snow123 项目：

- `frontend/`：前端静态页面资源
- `backend/`：Node + SQLite 服务
- `shared-data/`：原始共享数据

## 当前能力

- 报价前台
- 后台登录
- 商品 CRUD
- 分类/分组管理
- 报价单保存、详情、删除、备注编辑
- 批量操作
- 导出 CSV / Excel
- 密码修改
- 操作日志

## 本地启动

先导入数据库：

```bash
cd /Users/casparsbijibendiannao/snow123-split/backend
npm run db:import
```

启动后端：

```bash
cd /Users/casparsbijibendiannao/snow123-split/backend
npm start
```

如需自定义后台密码：

```bash
cd /Users/casparsbijibendiannao/snow123-split/backend
SNOW123_ADMIN_PASSWORD='你的密码' npm start
```

本地默认后端地址：

- `http://127.0.0.1:8787/api/health`
- `http://127.0.0.1:8787/api/catalog`
- `http://127.0.0.1:8787/api/nav-meta`
- `http://127.0.0.1:8787/api/admin/items`
- `http://127.0.0.1:8787/api/quotes`
- `http://127.0.0.1:8787/api/admin/quotes`

## 前端配置

前端通过 `frontend/config.js` 指定 API 地址：

```js
window.SNOW123_API_BASE = 'https://your-backend-domain.onrender.com';
```

说明：

- 本地开发时可留空，页面会回退到 `http://127.0.0.1:8787`
- 线上部署时，把 `frontend/config.js` 改成你的后端公网地址
- 也提供了 `frontend/config.example.js` 作为模板

## 后端环境变量

参考 `backend/.env.example`：

- `PORT`：服务端口
- `HOST`：监听地址，线上建议 `0.0.0.0`
- `CORS_ORIGIN`：允许访问的前端域名
- `DATA_DIR`：SQLite 数据目录
- `SNOW123_ADMIN_PASSWORD`：首次启动默认后台密码

## 推荐正式上线方案

推荐直接部署到 Render 单服务。

原因：

- 前端页面现在可以由后端直接托管
- 只需要一个固定公网域名
- SQLite 只需要挂一块持久磁盘
- 比前后端分开部署更省事

## Render 正式上线

项目根目录已带 `render.yaml`，直接可用。

这版会同时提供：

- 网站首页
- 报价页
- 后台页
- API

关键配置：

- 服务目录：`backend`
- 启动命令：`npm start`
- 持久磁盘挂载：`/var/data`
- 数据目录环境变量：`DATA_DIR=/var/data`

需要你在 Render 填的环境变量只有：

- `SNOW123_ADMIN_PASSWORD=你的后台密码`

如果是首次上线，部署完成后执行一次数据库导入：

```bash
cd backend
npm run db:import
```

## 访问入口

Render 部署成功后，一个域名就够了：

- 首页：`https://你的域名/`
- 报价页：`https://你的域名/quote.html`
- 后台页：`https://你的域名/admin.html`

## 访问入口

## 注意事项

- 当前后端使用 SQLite，必须保留持久磁盘
- 当前后台 token 是内存会话，后端重启后需要重新登录
- 如果你以后改成前后端分离部署，再单独配置 `frontend/config.js`
