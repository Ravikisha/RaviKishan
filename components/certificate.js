import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { data } from "./data_cert";
import * as Dialog from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import Image from "next/image";
import LinkedInLogo from "../public/company/linkedin.png";
import CertificateLogo from "../public/assets/certificate.jpg";

const Certificate = () => {
  const [cert, setCert] = useState(data);
  const [filterData, setFilterData] = useState(data);
  const [activeFilter, setActiveFilter] = useState("All");

  return (
    <>
      <div className="PL__container" data-aos="fade-up" data-aos-delay="100">
        <h2 className="text-4xl font-bold mb-2 text-center">Certificates</h2>
        <h2 className="text-2xl mb-2 text-center">
          See what i certified about{" "}
          <span className="text-sky-500 font-bold text-3xl underline">
            programming
          </span>
        </h2>
        <Filter
          popular={cert}
          setFiltered={setFilterData}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
        />
        <motion.div>
          <AnimatePresence>
            <div className="PL__content">
              {filterData.map((cert) => {
                return (
                  <div
                    key={cert.name}
                    data-aos="zoom-in-up"
                    className="px-4 md:px-0"
                  >
                    <Card cert={cert} />
                  </div>
                );
              })}
              ;
            </div>
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
};

export default Certificate;

const Filter = ({ popular, setFiltered, activeFilter, setActiveFilter }) => {
  useEffect(() => {
    if (activeFilter === "All") {
      setFiltered(popular);
    } else {
      setFiltered(popular.filter((PL) => PL.tags.includes(activeFilter)));
    }
  }, [activeFilter]);
  return (
    <>
      <div className="flex justify-center align-center my-10 gap-4 flex-wrap px-2 md:px-0">
        <button
          onClick={() => setActiveFilter("All")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500 ${
            activeFilter === "All"
              ? "bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          All
        </button>
        <button
          onClick={() => setActiveFilter("PL")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "PL"
              ? "bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Programming Language
        </button>
        <button
          onClick={() => setActiveFilter("frontend")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "frontend"
              ? "bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Frontend
        </button>
        <button
          onClick={() => setActiveFilter("backend")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "backend"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Backend
        </button>
        <button
          onClick={() => setActiveFilter("app")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "app"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          App Developement
        </button>
        <button
          onClick={() => setActiveFilter("devops")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "devops"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          DevOps
        </button>
        <button
          onClick={() => setActiveFilter("aiml")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "aiml"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          AI/ML/DS
        </button>
        <button
          onClick={() => setActiveFilter("others")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "others"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Others
        </button>
      </div>
    </>
  );
};

export const Card = (props) => {
  const { name, organization, description, image, link, linkedin, tags } =
    props.cert;
  return (
    <>
    <Dialog.Root>
      <div className="relative flex max-w-[24rem] flex-col overflow-hidden rounded-xl bg-white bg-clip-border text-gray-700 shadow-md">
        <div className="relative m-0 overflow-hidden text-gray-700 bg-transparent rounded-none shadow-none bg-clip-border">
          <Image
            src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?ixlib=rb-4.0.3&amp;ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&amp;auto=format&amp;fit=crop&amp;w=1471&amp;q=80"
            alt="ui/ux review check"
            width={600}
            height={400}
            objectFit="contain"
          />
        </div>
        <div className="p-4 flex gap-2 flex-col justify-start items-start">
          <h4 className="block text-2xl antialiased font-semibold leading-snug tracking-normal text-blue-gray-900">
            {name}
          </h4>
          <Image src={
            "/company/" + organization + ".png"
          } alt={organization} height={50} width={80} objectFit="contain" />
          <p className="block text-lg antialiased font-normal leading-relaxed text-gray-700 overflow-auto">
            {description.substring(0, 90)}...
          </p>
        </div>
        <div className="flex items-center justify-between p-4">
            <a href={linkedin} target="_blank" rel="noreferrer" className="flex items-center">
              <Image src={LinkedInLogo} alt="linkedin" height={40} width={70} objectFit="contain" />
            </a>
            <a href={link} target="_blank" rel="noreferrer" className="flex items-center">
              <Image src={CertificateLogo} alt="linkedin" height={40} width={70} objectFit="contain" />
            </a>
        </div>
        <Dialog.Trigger asChild>
          <button className="text-violet11 shadow-blackA4 hover:bg-mauve3 inline-flex items-center justify-center rounded-[4px] bg-white p-4 font-medium leading-none shadow-[0_2px_10px] focus:shadow-[0_0_0_2px] focus:shadow-black focus:outline-none">
            Read More
          </button>
        </Dialog.Trigger>
      </div>
        
        <Dialog.Portal>
          <Dialog.Overlay className="bg-blackA6 data-[state=open]:animate-overlayShow fixed inset-0" />
          <Dialog.Content className="data-[state=open]:animate-contentShow fixed top-[50%] left-[50%] w-[80vw] md:w-[50vw] translate-x-[-50%] translate-y-[-50%] rounded-[6px] bg-white p-[25px] shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] focus:outline-none z-[9999]">
            <div className="bg-gray-100 flex rounded-2xl shadow-lg w-full p-5 items-center absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex-col md:flex-row gap-4">
              <div className="w-1/2">
                <img
                  className="rounded-2xl w-full"
                  src="https://images.unsplash.com/photo-1616606103915-dea7be788566?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1887&q=80"
                />
              </div>
              <div className="md:w-1/2 px-8 md:px-16">
                <h2 className="font-bold text-2xl text-[#002D74]">Login</h2>
                <p className="text-xs mt-4 text-[#002D74]">
                  If you are already a member, easily log in
                </p>
              </div>

              <Dialog.Close asChild>
                <button
                  className="text-violet11 hover:bg-violet4 focus:shadow-violet7 absolute top-[10px] right-[10px] inline-flex h-[25px] w-[25px] appearance-none items-center justify-center rounded-full focus:shadow-[0_0_0_2px] focus:outline-none border-1 border-black hover:border-violet11"
                  aria-label="Close"
                >
                  <Cross2Icon />
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};