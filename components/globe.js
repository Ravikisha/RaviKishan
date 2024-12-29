 
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs) {
  return twMerge(clsx(inputs));
}
export function Globe({
  className,
  children,
  reverse,
  duration = 20,
  delay = 10,
  radius = 50,
}) {
  return (
    <> 
      <div
        style={
          {
            "--duration": duration,
            "--radius": radius,
            "--delay": -delay,
          }
        }
        className={cn(
          "absolute flex size-full transform-gpu animate-orbit items-center justify-center rounded-full border bg-black/10 [animation-delay:calc(var(--delay)*1000ms)]",
          { "[animation-direction:reverse]": reverse },
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}