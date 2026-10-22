import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";

export default function InstallGuide() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const update = () =>
      setInstalled(
        media.matches ||
          Boolean(
            (navigator as Navigator & { standalone?: boolean }).standalone,
          ),
      );
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (installed) return null;
  return (
    <details className="bucket-install">
      <summary>
        <Smartphone size={16} />
        安装到 iPhone / iPad
      </summary>
      <div>
        <p>用 Safari 打开拾序，把这个桶放到主屏幕。</p>
        <ol>
          <li>
            点击 Safari 的分享按钮（方框向上箭头）；部分版本需先点“更多”。
          </li>
          <li>选择“添加到主屏幕”，找不到时展开更多操作。</li>
          <li>如果显示“作为网页 App 打开”，请开启，再点“添加”。</li>
        </ol>
        <p>
          从主屏幕打开后，点“放个文件”选择“文件”中的资料。老师发在微信里的文件，可以先存到“文件”再选取。
        </p>
        <p>
          内容暂存于当前设备，不会自动同步。建议从主屏幕固定入口使用，并在设置中定期备份。首次打开和
          AI 整理需要联网；整理时请保持页面在前台。
        </p>
      </div>
    </details>
  );
}
