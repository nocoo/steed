import { Toaster as SonnerToaster, toast } from "sonner";

export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-background border-border text-foreground",
          title: "text-foreground",
          description: "text-muted-foreground",
        },
      }}
    />
  );
}
