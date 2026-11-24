import { useSettled } from "../../lib/hooks";

// The page's one polite announcement. Text present when the page loads is not read out, so a
// resumed draft stays silent; later text is settled for 300 ms so only the last count is heard.
export function StatusRegion({ message }: { readonly message: string }) {
  const settled = useSettled(message, 300);
  return (
    <div role="status" className="sr-only">
      {settled}
    </div>
  );
}
