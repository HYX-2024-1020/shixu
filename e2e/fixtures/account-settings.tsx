import ReactDOM from "react-dom/client";
import AccountConnection from "../../src/bucket/AccountConnection";
import "../../src/bucket/bucket.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AccountConnection
    canSwitch={() => true}
    onClose={() => {}}
    notify={() => {}}
  />,
);
