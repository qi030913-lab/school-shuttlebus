# backend-springboot

## 运行前准备

1. 创建 MySQL 数据库：

```sql
CREATE DATABASE shuttle_demo DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
```

2. 修改 `src/main/resources/application.yml` 中的数据库账号密码。

3. 如果你要接真实微信小程序登录，把下面两个配置改成你自己的：

```yaml
wechat:
  miniapp:
    app-id: 你的小程序 appid
    secret: 你的小程序 secret
    mock-login-enabled: false
```

如果你只是本地演示，可以保留：

```yaml
mock-login-enabled: true
```

这样后端会跳过真实的 `jscode2session` 调用，改用 mock openid，方便在微信开发者工具里先跑通 Demo。

## 启动

```bash
mvn spring-boot:run
```

## 当前核心接口

- `POST /api/driver/wx-login` 司机微信登录
- `GET /api/driver/me` 获取当前司机信息
- `POST /api/driver/start` 发车
- `POST /api/driver/stop` 收车
- `POST /api/driver/location` 上传位置
- `GET /api/common/routes` 查询线路
- `GET /api/user/overview?routeId=R1` 用户端查看线路总览

## 司机端鉴权说明

司机登录成功后，后端会返回 `loginToken`。
之后司机端调用 `/api/driver/me`、`/api/driver/start`、`/api/driver/stop`、`/api/driver/location` 时，需要在请求头里带：

```http
X-Driver-Token: 返回的loginToken
```
