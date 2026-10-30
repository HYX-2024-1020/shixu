export default function AdminTestGuide() {
  return (
    <aside className="admin-test-guide" aria-label="管理员测试版说明">
      <details>
        <summary>
          <strong>管理员测试版</strong>
          <span>手机本地 · API 直连</span>
        </summary>
        <ol>
          <li>在“连接与设置”填自己的 DeepSeek API 密钥，读取模型后连接。</li>
          <li>
            在桶里粘贴通知或添加普通附件，点“喂！”，到世界和 DDL
            查看、编辑与完成。
          </li>
          <li>
            设置里可备份和恢复资料。先添加到主屏幕，以后固定从该入口打开。
          </li>
        </ol>
        <p>
          关闭后重新打开，已保存的文字和事项仍在。输入草稿请等下方显示“草稿已保存在此设备”再离开。
        </p>
        <p>
          资料只存在当前浏览器；其他设备打开同一网址看不到你的资料。这里没有登录保护，能使用这台手机的人可以看到内容。
        </p>
        <p>
          AI 会把相关内容发送给 DeepSeek
          并产生费用。整理时保持页面打开；没有跨设备同步、系统提醒或新版服务器的大附件分块与断点恢复。清理网站数据或换手机前请备份。
        </p>
        <p>
          使用当前主线的界面、日期和整理规则；不包含开发中的服务端任务系统。普通附件读取失败时请复制文字或换成清晰图片。
        </p>
      </details>
    </aside>
  );
}
