import React, { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { Globe } from "./globe";
import Image from 'next/image'

const Year5 = () => {
  return (
    <>
      <section className="sec" data-aos="fade-up">
        <div className="sec__content">
          <div className="sec__textBox">
            <h2>
              That&apos;s What <br /> <span>I Build</span>
            </h2>
            <p>
              I am a hardly working person. I always try to learn new things and
              best way to learn is to build something. I have built many
              projects and I am still learning. I love to do something
              innovative and creative things.
            </p>
            <div className="flex gap-3">
              <Link href="/projects">View All Projects</Link>
              <Link href="/skills">View My SKills</Link>
            </div>
          </div>
          <div className="sec__imgBox" data-aos="zoom-in" data-aos-delay="200">
            <div className="relative flex h-[500px] w-full flex-col items-center justify-center overflow-hidden rounded-lg bg-background ">
              <span className="pointer-events-none whitespace-pre-wrap bg-gradient-to-b from-black to-gray-300 bg-clip-text text-center text-8xl font-semibold leading-none text-transparent dark:from-white dark:to-black">
                Tech
              </span>

              {/* Inner Circles */}
              <Globe
                className="size-[30px] border-none bg-transparent"
                duration={20}
                delay={5}
                radius={80}
              >
            <Image alt="Google Cloud" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/googlecloud/googlecloud-original.svg" width={70} height={70}/>
              </Globe>
              <Globe
                className="size-[30px] border-none bg-transparent"
                duration={20}
                delay={10}
                radius={80}
              >
            <Image alt="nextjs" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nextjs/nextjs-original.svg" width={70} height={70}/>
              </Globe>
              <Globe
                className="size-[30px] border-none bg-transparent"
                duration={20}
                delay={15}
                radius={80}
              >
            <Image alt="golang" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original-wordmark.svg" width={70} height={70}/>
              </Globe>
              <Globe
                className="size-[30px] border-none bg-transparent"
                duration={20}
                delay={20}
                radius={80}
              >
                
            <Image alt="kubernetes" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/kubernetes/kubernetes-original.svg" width={70} height={70} />
          
              </Globe>

              {/* Outer Circles (reverse) */}
              <Globe
                className="size-[50px] border-none bg-transparent"
                radius={200}
                duration={40}
                delay={5}
                reverse
              >
                
            <Image alt="rust" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rust/rust-original.svg" height={80} width={80} />
          
              </Globe>
              <Globe
                className="size-[50px] border-none bg-transparent"
                radius={200}
                duration={40}
                delay={10}
                reverse
              >
                
            <Image alt="github" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/github/github-original.svg" width={80} height={80} />
          
              </Globe>
              <Globe
                className="size-[50px] border-none bg-transparent"
                radius={200}
                duration={40}
                delay={15}
                reverse
              >
                
            <Image alt="aws" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/amazonwebservices/amazonwebservices-original-wordmark.svg" width={80} height={80} />
          
              </Globe>
              <Globe
                className="size-[50px] border-none bg-transparent"
                radius={200}
                duration={40}
                delay={20}
                reverse
              >
                
            <Image alt="typescript" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/typescript/typescript-original.svg" width={80} height={80} />
          
              </Globe>

              <Globe
                className="size-[50px] border-none bg-transparent"
                radius={200}
                duration={40}
                delay={25}
                reverse
              >
                
            <Image alt="react" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/react/react-original.svg" width={80} height={80} />
          
              </Globe>

              <Globe
                className="size-[50px] border-none bg-transparent"
                radius={200}
                duration={40}
                delay={30}
                reverse
                >
                  <Image alt="tensorflow" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/tensorflow/tensorflow-original.svg" width={80} height={80} />
                  </Globe>

                  <Globe
                  className="size-[50px] border-none bg-transparent"
                  radius={200}
                  duration={40}
                  delay={35}
                  reverse
                  >
                    <Image alt="azure" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/azure/azure-original.svg" width={80} height={80} />
                    </Globe>
                    <Globe
                    className="size-[50px] border-none bg-transparent"
                    radius={200}
                    duration={40}
                    delay={40}
                    reverse
                    >
                      <Image alt="flutter" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/flutter/flutter-original.svg" width={80} height={80} />
                      </Globe>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};


export default Year5;
