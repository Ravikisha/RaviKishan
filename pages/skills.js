import React from "react";
import Languages from "../components/languages";
import PureParallax from "./../components/pureParallax";
import Head from "next/head";
import Certificate from "../components/certificate";

const Skills = () => {
  return (
    <>
      <Head>
        <title>My Skills</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
      <PureParallax />
      <Languages />
      <hr className="my-10 border-gray-300 border-2 w-[80%] mx-auto" id="certificate" />
      <Certificate />
    </>
  );
};

export default Skills;
