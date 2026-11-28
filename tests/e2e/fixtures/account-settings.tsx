import ReactDOM from "react-dom/client";
import AccountConnection from "../../../apps/web/src/bucket/AccountConnection";
import "../../../apps/web/src/bucket/bucket.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AccountConnection
    canSwitch={() => true}
    onClose={() => {}}
    notify={() => {}}
  />,
);
