import { cn } from "./utils/utils";
import React, { useEffect, useState } from "react";
import { useTheme } from "./utils/ThemeProvider";

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
  const { theme } = useTheme();

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
      <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-colors duration-300">
      
        {[...meteorStyles].map((style, idx) => (
          // Meteor Head
          <span
            key={idx}
            style={{ ...style }}
            className={cn(
              "pointer-events-none absolute size-0.5 rotate-[var(--angle)] animate-meteor rounded-full shadow-[0_0_0_1px_#ffffff10] transition-colors duration-300",
              theme === 'dark' 
                ? "bg-purple-400 shadow-[0_0_0_1px_#a855f750]" 
                : "bg-zinc-800 shadow-[0_0_0_1px_#ffffff10]",
              className
            )}
          >
            {/* Meteor Tail */}
            <div className={cn(
              "pointer-events-none absolute top-1/2 -z-10 h-px w-[50px] -translate-y-1/2 transition-colors duration-300",
              theme === 'dark'
                ? "bg-gradient-to-r from-purple-400 to-transparent"
                : "bg-gradient-to-r from-zinc-500 to-transparent"
            )} />
          </span>
        ))}
        <span className={cn(
          "pointer-events-none whitespace-pre-wrap bg-clip-text text-center text-8xl font-semibold leading-none text-transparent transition-colors duration-300",
          theme === 'dark'
            ? "bg-gradient-to-b from-purple-400 to-gray-300/80"
            : "bg-gradient-to-b from-black to-gray-300/80"
        )}>
          Contact
        </span>
        
      </div>
    </>
  );
};
