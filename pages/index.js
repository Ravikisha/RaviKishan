import React from "react";
import HomePage from "../components/Homepage";
import Map from "../components/map";
import Light from "../components/light";
import WorkerSection from "./../components/workerSection";
import Head from "next/head";
import ProjectReference from "./../components/projectReference";

const Home = () => {

  return (
    <>
      <Head>
        <title>Ravi Kishan | Full Stack Developer Portfolio</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
          <section className="main">
            <HomePage />
          </section>
          <Light />
          {/* <ThreeDPage/> */}
          <ProjectReference />
          <Map className="map__page" />
          <WorkerSection />
        </>
  );
};



export default Home;
