import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
const App = lazy(() =>
  new URLSearchParams(location.search).get("legacy") === "1"
    ? import("./LegacyApp")
    : import("./bucket/BucketApp"),
);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <Suspense
    fallback={
      <div
        style={{
          padding: "20vh 24px",
          textAlign: "center",
          fontFamily: "sans-serif",
          color: "#697b70",
        }}
      >
        正在打开拾序…
      </div>
    }
  >
    <App />
  </Suspense>,
);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .catch(() => {});
  });
