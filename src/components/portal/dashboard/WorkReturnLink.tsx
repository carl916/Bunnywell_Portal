"use client";
import { useEffect, useState } from "react";

export function WorkReturnLink({ screen }: { screen: string }) {
  const [url, setUrl] = useState("");
  const [register, setRegister] = useState(false);
  useEffect(() => {
    const update = () => {
      const params = new URLSearchParams(window.location.search);
      const target = params.get("workReturn");
      const fromRegister = params.get("workRegister") === "1";
      setRegister(fromRegister);
      setUrl(fromRegister && !params.has("salesUnitId") ? "" : target === "dashboard" || target === "sales" ? `/?${new URLSearchParams({ screen: target, building: params.get("workScope") || "all" })}` : "");
    };
    const timer = setTimeout(update, 0);
    window.addEventListener("popstate", update);
    window.addEventListener("conveyancer-sale-navigation", update);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", update); window.removeEventListener("conveyancer-sale-navigation", update); };
  }, [screen]);
  if (!url) return null;
  return <a href={url} className="secondary mb-4 w-fit min-h-11" onClick={event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); window.history.pushState(null, "", url); window.dispatchEvent(new PopStateEvent("popstate"));
  }}>{register ? "Back to Sales" : "Back to organisation work"}</a>;
}
