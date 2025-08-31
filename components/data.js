import React from "react";
import Link from "next/link";
import { Sparkles, Mail, ArrowRight  } from "lucide-react";
import {Badge} from "./ui/badge"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import {cn} from "./utils/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}


const Data = () => {
  return (
    <>
      <div className="home__data">
        <div className="flex items-center space-x-2">
          <span className="text-4xl">👋</span>
          <Badge
            variant="secondary"
            className="bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 border-0"
          >
            <Sparkles className="w-3 h-3 mr-1" />
            Available for work
          </Badge>
        </div>
        {/* <h1 className="home__title">Ravi Kishan</h1> */}
        <h1 className="text-5xl lg:text-7xl font-bold leading-tight">
                <span className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 bg-clip-text text-transparent">
                  Ravi Kishan
                </span>
              </h1>
        <h3 className="home__subtitle">Full Stack Developer</h3>
        <p className="home__description">
          I&apos;m a full stack developer with a passion for creating beautiful
          and functional websites and applications.
        </p>
        <div className="flex flex-wrap gap-2">
                {["React", "Next.js", "TypeScript", "Node.js", "Python"].map((skill) => (
                  <Badge key={skill} variant="outline" className="bg-white/50 backdrop-blur-sm">
                    {skill}
                  </Badge>
                ))}
              </div>
              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Link href="/contact">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-slate-900 to-slate-700 hover:from-slate-800 hover:to-slate-600 text-white shadow-lg hover:shadow-xl transition-all duration-300 group cursor-pointer"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Hire Me
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                </Link>
                <Link href="/projects">
                <Button
                  variant="outline"
                  size="lg"
                  className="bg-white/50 backdrop-blur-sm  hover:bg-gray-800 transition-all duration-300 border hover:text-white"
                >
                  View Projects
                </Button>
                </Link>
              </div>
        
      </div>
    </>
  );
};

export default Data;
