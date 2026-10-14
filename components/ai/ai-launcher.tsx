import { Sparkles } from "lucide-react";

export function AiLauncher({ onClick }: { onClick: () => void }) {
  return <button type="button" className="secondary-button" onClick={onClick}><Sparkles size={15} />Open AI helper</button>;
}
