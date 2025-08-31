import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { Loader } from "@react-three/drei";
import { Awsome } from "../components/awsome";

import React from "react";
import Projects from "../components/projects";
import Articles from "../components/articles";
import Head from 'next/head';


const Contact = () => {
  return (
    <>
    <Head>
        <title>My Projects</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
      <Suspense fallback={null}>
        <Awsome />
      </Suspense>
      <Loader />
      <Projects />
      <hr className="my-5 border-gray-300 border-2 w-[80%] mx-auto" />
      <Articles />
    </>
  );
};

export default Contact;
