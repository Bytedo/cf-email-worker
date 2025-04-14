import PostalMime from 'postal-mime';
import { htmlToText } from 'html-to-text';

export default {
  /**
   * 邮件处理函数
   * @param {EmailMessage} message - 包含邮件信息的对象
   * @param {object} env - 包含环境变量和绑定的对象
   * @param {object} ctx - 执行上下文
   */
  async email(message, env, ctx) {
    // 检查必要的环境变量
    if (!env.API_BASE_URL || !env.API_ACCESS_TOKEN || !env.API_USER_ID) {
      console.error("错误：缺少必要的 API 环境变量 (API_BASE_URL, API_ACCESS_TOKEN, API_USER_ID)");
      // message.setReject("Worker配置错误: API配置缺失");
      return;
    }
    // 检查R2绑定
    if (!env.R2_BUCKET) {
        console.warn("警告：R2_BUCKET 未绑定。将无法处理邮件附件。");
    }
    const useR2CustomDomain = !!env.R2_CUSTOM_DOMAIN_URL;
    const useR2DevDomain = !!env.R2_BUCKET_NAME;
    if (env.R2_BUCKET && !useR2CustomDomain && !useR2DevDomain) {
       console.warn("警告：已绑定 R2 但未在 wrangler.toml [vars] 中配置 R2_CUSTOM_DOMAIN_URL 或 R2_BUCKET_NAME。将无法生成有效的附件链接。");
    }

    try {
      // 解析邮件
      const parser = new PostalMime();
      const parsedEmail = await parser.parse(message.raw);

      // 提取信息
      const from = message.headers.get("from") || parsedEmail.from?.address || "未知发件人";
      const toHeader = message.headers.get("to");
      const to = toHeader || (parsedEmail.to && parsedEmail.to.length > 0 ? parsedEmail.to.map(r => r.address).join(', ') : "未知收件人");
      const subject = parsedEmail.subject || "无主题";
      const textBody = parsedEmail.text || "";
      const htmlBody = parsedEmail.html || "";

      let emailBodyContent = "";
      if (htmlBody) {
        //使用 html-to-text 转换html内容
        emailBodyContent = htmlToText(htmlBody, {
          wordwrap: false,
          preserveNewlines: true, //尝试保留有意义的换行
          selectors: [
            {
              //处理链接 (<a> 标签)
              selector: 'a',
              options: {
                //在链接文本后添加 URL
                linkBrackets: [' (', ')'],
                 noLinkBrackets: false //改为 false 以启用 linkBrackets
              }
            },
            // 处理 style 和图片
            { selector: 'style', format: 'skip' },
            { selector: 'script', format: 'skip' },
            { selector: 'img', format: 'inline', options: {linkBrackets: false} },
          ]
        });
      } else if (textBody) {
        emailBodyContent = textBody;
      }
      emailBodyContent = emailBodyContent.replace(/\n{3,}/g, '\n\n').trim();


      //处理附件
      let attachmentInfo = "\n\n--- 附件信息 ---\n";
      let attachmentCount = 0;
      const MAX_ATTACHMENTS_TO_PROCESS = 10;

      if (env.R2_BUCKET && parsedEmail.attachments && parsedEmail.attachments.length > 0) {
        for (let i = 0; i < Math.min(parsedEmail.attachments.length, MAX_ATTACHMENTS_TO_PROCESS); i++) {
            const attachment = parsedEmail.attachments[i];
            try {
                const filename = attachment.filename || `attachment-${Date.now()}`;
                const safeFilename = encodeURIComponent(filename);
                const r2Key = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}-${safeFilename}`;

                await env.R2_BUCKET.put(r2Key, attachment.content, {
                    httpMetadata: { contentType: attachment.mimeType },
                });

                let publicUrl = "无法生成链接 (R2 链接配置缺失)";
                if (useR2CustomDomain && env.R2_CUSTOM_DOMAIN_URL) {
                    const customDomainBase = env.R2_CUSTOM_DOMAIN_URL.endsWith('/') ? env.R2_CUSTOM_DOMAIN_URL.slice(0, -1) : env.R2_CUSTOM_DOMAIN_URL;
                    publicUrl = `${customDomainBase}/${r2Key}`;
                } else if (useR2DevDomain && env.R2_BUCKET_NAME) {
                    publicUrl = `https://${env.R2_BUCKET_NAME}.r2.dev/${r2Key}`;
                }

                attachmentInfo += `附件 ${i+1}: ${filename} (${attachment.mimeType})\n链接: ${publicUrl}\n`;
                attachmentCount++;
            } catch (uploadError) {
                console.error(`附件上传失败: ${attachment.filename || '未知文件名'}`, uploadError);
                attachmentInfo += `附件 ${i+1}: ${attachment.filename || '未知文件名'} (上传失败)\n`;
            }
        }
         if (parsedEmail.attachments.length > MAX_ATTACHMENTS_TO_PROCESS) {
            attachmentInfo += `\n注意：附件过多，仅处理了前 ${MAX_ATTACHMENTS_TO_PROCESS} 个。\n`;
        }
      } else if (!env.R2_BUCKET) {
          attachmentInfo += "R2 未绑定，跳过附件处理。\n";
      } else {
         attachmentInfo += "无附件\n";
      }

      //准备发送的消息体
      const messageToSend = `
新邮件通知
--------------------
发件人: ${from}
收件人: ${to}
主题: ${subject}
--------------------
正文:
${emailBodyContent}
--------------------
${attachmentCount > 0 || !env.R2_BUCKET ? attachmentInfo.trim() : "无附件"}
      `.trim();

      //使用POST请求发送数据
      const apiUrl = new URL(env.API_BASE_URL);
      apiUrl.searchParams.append('access_token', env.API_ACCESS_TOKEN);
      apiUrl.searchParams.append('group_id', env.API_USER_ID);

      const formData = new URLSearchParams();
      formData.append('message', messageToSend); //messageToSend现在包含处理后的纯文本正文

      const apiResponse = await fetch(apiUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      // 处理API响应
      if (!apiResponse.ok) {
        console.error(`API 请求失败: ${apiResponse.status} ${apiResponse.statusText}`);
        const errorBody = await apiResponse.text();
        console.error(`API 错误响应: ${errorBody}`);
        try {
          //替换为真实备用邮箱地址
          await message.forward("fallback@example.com");
          console.log("邮件处理失败，已尝试转发到备用地址。");
        } catch (forwardError) {
          console.error("转发到备用地址也失败:", forwardError);
          message.setReject(`Worker 内部处理错误且无法转发: API请求失败`);
        }
      } else {
        console.log("邮件已成功通过 POST 请求转发到指定 API");
        // const successBody = await apiResponse.text();
        // console.log("API 成功响应:", successBody);
      }

    } catch (error) {
      console.error("处理邮件时发生严重错误:", error);
       try {
         //替换为真实备用邮箱地址
         await message.forward("fallback@example.com");
         console.log("邮件处理失败，已转发到备用地址。");
       } catch (forwardError) {
         console.error("转发到备用地址也失败:", forwardError);
         message.setReject(`Worker 内部处理错误且无法转发: ${error.message}`);
       }
    }
  }
};
