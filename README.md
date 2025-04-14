# Cloudflare 邮件转发 Worker

这个项目是一个基于 Cloudflare Workers 的邮件处理转发项目，主要功能是接收邮件并将邮件内容转发到指定的 API。
项目中的 API 使用的是 napcat 的接口，主要用于转发邮件内容到 QQ，其他 API 可用根据情况进行修改。

## 主要功能

- **邮件接收**：通过 Cloudflare Email Workers 接收发送到配置域名的邮件。
- **正文处理**：使用 html-to-text 库对正文内容进行处理，只保留文字和链接内容。
- **附件处理**：提取邮件附件并上传到 Cloudflare R2 存储桶。
- **API 转发**：将邮件内容（包括发件人、收件人、主题、正文和附件 URL）转发到指定 API。

## 环境需求

- Cloudflare 上托管的域名
- Cloudflare Workers 环境
- Cloudflare R2 存储桶
- 已配置的自定义域名（用于接收邮件）

## 安装与部署

1. clone 代码
```
git clone https://github.com/Bytedo/cf-email-worker.git
cd cf-email-worker
```

2. 安装依赖
```
npm install
```

3. 配置环境变量
创建 `wrangler.toml` 文件或修改现有文件：

```
name = "cf-email-worker"      # worker项目名称
main = "src/index.js"
compatibility_date = "2023-11-01"

[vars]
# API 配置 (以onebot v11 为例)
API_BASE_URL = "https://exmlple.com/send_private_msg"
API_ACCESS_TOKEN = "123456" # access_token
API_USER_ID = "123456"      # user_id 或 group_id, 群聊需将 index.js 第127行改为 group_id

# R2 存储域名需手动填写，可用官方分配或自己绑定的
R2_CUSTOM_DOMAIN_URL = "https://*.r2.dev"

# R2 存储桶配置
[[r2_buckets]]
binding = "R2_BUCKET"         # Worker中用来操作R2的对象名，可忽略
bucket_name = "wremail"       # 填写R2存储桶名称
preview_bucket_name = "wremail-dev" #开发测试用的，可忽略
```

4. 部署到 Cloudflare

登录cloudflare
```
npx wrangler login
```
部署
```
npx wrangler deploy
```

5. 在 Cloudflare 控制台中配置 Email Worker
- 转到 Email Routing > Email Workers
- 创建一个新的 Email Worker 路由，选择刚刚部署的 Worker


