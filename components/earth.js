import { cn } from "./utils/utils";
import React, { useEffect, useState } from "react";

export const Earth = ({
  number = 30,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className,
}) => {
  const [meteorStyles, setMeteorStyles] = useState([]);

  useEffect(() => {
    const styles = [...new Array(number)].map(() => ({
      "--angle": angle + "deg",
      top: -5,
      left: `calc(-50% + ${Math.floor(Math.random() * window.innerWidth)}px)`,
      animationDelay: Math.random() * (maxDelay - minDelay) + minDelay + "s",
      animationDuration:
        Math.floor(Math.random() * (maxDuration - minDuration) + minDuration) +
        "s",
    }));
    setMeteorStyles(styles);
  }, [number, minDelay, maxDelay, minDuration, maxDuration, angle]);

  return (
    <>
      <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden rounded-lg border">
      
        {[...meteorStyles].map((style, idx) => (
          // Meteor Head
          <span
            key={idx}
            style={{ ...style }}
            className={cn(
              "pointer-events-none absolute size-0.5 rotate-[var(--angle)] animate-meteor rounded-full bg-zinc-800 shadow-[0_0_0_1px_#ffffff10]",
              className
            )}
          >
            {/* Meteor Tail */}
            <div className="pointer-events-none absolute top-1/2 -z-10 h-px w-[50px] -translate-y-1/2 bg-gradient-to-r from-zinc-500 to-transparent" />
          </span>
        ))}
        <span className="pointer-events-none whitespace-pre-wrap bg-gradient-to-b from-black to-gray-300/80 bg-clip-text text-center text-8xl font-semibold leading-none text-transparent">
          Contact
        </span>
        
      </div>
    </>
  );
};
