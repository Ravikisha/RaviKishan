import React, { useState, useRef, useEffect, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { IconCloud } from "./globe";

const slugs = [
  "typescript",
  "javascript",
  "dart",
  "rust",
  "java",
  "react",
  "flutter",
  "android",
  "html5",
  "css3",
  "nodedotjs",
  "express",
  "nextdotjs",
  "prisma",
  "amazonaws",
  "postgresql",
  "firebase",
  "nginx",
  "vercel",
  "testinglibrary",
  "jest",
  "cypress",
  "docker",
  "git",
  "jira",
  "github",
  "gitlab",
  "visualstudiocode",
  "androidstudio",
  "sonarqube",
  "figma",
];

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
            <Suspense fallback={<div>Loading...</div>}>
              <IconCloud iconSlugs={slugs} />
            </Suspense>
          </div>
        </div>
      </section>
    </>
  );
};

export default Year5;
