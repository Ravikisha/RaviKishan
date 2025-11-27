import React, { useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { Globe } from "./globe";
import Image from 'next/image'

const Year5 = () => {
  return (
    <>
      <section className="sec bg-white dark:bg-gray-900 transition-colors duration-300" data-aos="fade-up">
        <div className="sec__content">
          <div className="sec__textBox">
            <h2 className="text-gray-900 dark:text-gray-100 transition-colors duration-300">
              That&apos;s What <br /> <span className="text-purple-600 dark:text-purple-400">I Build</span>
            </h2>
            <p className="text-gray-700 dark:text-gray-300 transition-colors duration-300">
              I am a hardly working person. I always try to learn new things and
              best way to learn is to build something. I have built many
              projects and I am still learning. I love to do something
              innovative and creative things.
            </p>
            <div className="flex gap-3 mt-6">
              <Link href="/projects">
                <button className="group relative inline-flex items-center justify-center px-6 py-3 text-lg font-medium text-white transition-all duration-300 ease-in-out bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 dark:from-purple-500 dark:to-purple-600 dark:hover:from-purple-600 dark:hover:to-purple-700 rounded-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900">
                  <span className="flex items-center">
                    View All Projects
                    <svg className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </span>
                </button>
              </Link>
              <Link href="/skills">
                <button className="group relative inline-flex items-center justify-center px-6 py-3 text-lg font-medium transition-all duration-300 ease-in-out bg-transparent border-2 border-purple-600 text-purple-600 hover:bg-purple-600 hover:text-white dark:border-purple-400 dark:text-purple-400 dark:hover:bg-purple-400 dark:hover:text-gray-900 rounded-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900">
                  <span className="flex items-center">
                    View My Skills
                    <svg className="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>
              </Link>
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
