import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { data, languageBadge } from "./data_cert";
import * as Dialog from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import Image from "next/image";
import LinkedInLogo from "../public/company/linkedin.png";
import CertificateLogo from "../public/assets/certificate.jpg";
import { data as data_badge } from "./data_pl";
import { DownloadIcon } from "lucide-react";
import { badgeColorGenerator } from "./utils/utils";

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
                    <Card cert={cert} key={cert.name} />
                  </div>
                );
              })}
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
          onClick={() => setActiveFilter("academic")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "academic"
              ? "bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Academic
        </button>
        <button
          onClick={() => setActiveFilter("technical")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "technical"
              ? "bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Technical
        </button>
        <button
          onClick={() => setActiveFilter("competitions")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "competitions"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Competitions
        </button>
        <button
          onClick={() => setActiveFilter("experience")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "experience"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Experience
        </button>
        <button
          onClick={() => setActiveFilter("achievements")}
          className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${
            activeFilter === "achievements"
              ? " bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold"
              : ""
          }`}
        >
          Achievements
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
  const {
    name,
    organization,
    description,
    image,
    link,
    linkedin,
    tags,
    skills,
  } = props.cert;
  return (
    <>
      <Dialog.Root>
        <div className="relative flex max-w-[24rem] flex-col overflow-hidden rounded-xl bg-white bg-clip-border text-gray-700 shadow-md">
          <div className="relative m-0 overflow-hidden text-gray-700 bg-transparent rounded-none shadow-none bg-clip-border">
            <Image
              src={"/certificates/" + image}
              alt={name + " certificate Ravi Kishan"}
              width={600}
              height={400}
              objectFit="contain"
            />
          </div>
          <div className="p-4 flex gap-2 flex-col justify-start items-start">
            <h4 className="block text-2xl antialiased font-semibold leading-snug tracking-normal text-blue-gray-900">
              {name}
            </h4>
            <Image
              src={"/company/" + organization + ".png"}
              alt={organization}
              height={50}
              width={80}
              objectFit="contain"
            />
            <p className="block text-lg antialiased font-normal leading-relaxed text-gray-700 overflow-auto">
              {description.substring(0, 90)}...
            </p>
            <div className="flex items-center -space-x-3">
              {skills.map((skill) => {
                const imageData = data_badge.filter(
                  (badge) => badge.name.toLowerCase() === skill.toLowerCase()
                );
                if (imageData.length > 0) {
                  return (
                    <Image
                      src={imageData[0]["imageUrl"]}
                      alt={skill}
                      key={imageData[0]['name'] + " badge" + skill}
                      width={40}
                      height={40}
                      objectFit="cover"
                      className="relative inline-block !rounded-md border-2 border-white object-cover object-center hover:z-10"
                    />
                  );
                }
              })}
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <a
              href={linkedin}
              target="_blank"
              rel="noreferrer"
              className="flex items-center"
            >
              <Image
                src={LinkedInLogo}
                alt="linkedin"
                height={40}
                width={70}
                objectFit="contain"
              />
            </a>
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center"
            >
              <Image
                src={CertificateLogo}
                alt="linkedin"
                height={40}
                width={70}
                objectFit="contain"
              />
            </a>
          </div>
          <Dialog.Trigger asChild>
            <button className="shadow-blackA4 hover:bg-sky-700 inline-flex items-center justify-center rounded-[4px] bg-sky-500 text-white p-4 font-medium leading-none shadow-[0_2px_10px] focus:shadow-[0_0_0_2px] focus:shadow-black focus:outline-none">
              Read More
            </button>
          </Dialog.Trigger>
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="bg-blackA6 data-[state=open]:animate-overlayShow fixed inset-0" />
          <Dialog.Content className="data-[state=open]:animate-contentShow fixed top-[50%] left-[50%] w-[80vw] md:w-[50vw] translate-x-[-50%] translate-y-[-50%] rounded-[6px] bg-white p-[25px] shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] focus:outline-none z-[9999]">
            <div className="bg-gray-100 flex rounded-2xl shadow-lg w-full p-5 items-center absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex-col md:flex-row gap-4">
              <div className="w-full md:w-1/2 hidden md:block">
                <Image
                  src={"/certificates/" + image}
                  alt={name + " certificate Ravi Kishan"}
                  objectFit="contain"
                  width="100%"
                  height="100%"
                  layout="responsive"
                  className="w-full rounded-md"
                />
              </div>
              <div className="w-full md:w-1/2 px-2 md:px-16">
                <Image
                  src={"/company/" + organization + ".png"}
                  alt={organization}
                  height={50}
                  width={80}
                  objectFit="contain"
                />
                <h2 className="font-bold text-lg md:text-2xl text-[#002D74]">
                  {name}
                </h2>
                <p className="text-xs mt-2 md:mt-4 text-[#002D74]">
                  {description}
                </p>
                <div className="flex items-center justify-between p-2 md:p-4">
                  <a
                    href={linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center"
                  >
                    <Image
                      src={LinkedInLogo}
                      alt="linkedin"
                      height={40}
                      width={70}
                      objectFit="contain"
                    />
                  </a>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center"
                  >
                    <Image
                      src={CertificateLogo}
                      alt="linkedin"
                      height={40}
                      width={70}
                      objectFit="contain"
                    />
                  </a>
                </div>
                <h3 className="font-bold text-md md:text-lg text-[#002D74]">
                  # Skills
                </h3>
                <div className="flex flex-wrap gap-2 mt-1 md:mt-3">
                  {skills.map((skill) => {
                    const imageData = data_badge.filter(
                      (badge) =>
                        badge.name.toLowerCase() === skill.toLowerCase()
                    );
                    if (imageData.length > 0) {
                      return (
                        <Image
                          src={imageData[0]["imageUrl"]}
                          alt={skill}
                          key={skill}
                          width={40}
                          height={40}
                          objectFit="contain"
                          className="rounded-md"
                        />
                      );
                    } else {
                      return <></>;
                    }
                  })}
                </div>
                <h3 className="font-bold text-md md:text-lg text-[#002D74] mt-3">
                  # Tags
                </h3>
                <div className="flex flex-wrap gap-2 mt-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className={`text-sm font-medium me-2 px-2.5 py-0.5 rounded ${badgeColorGenerator()}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  className="text-violet11 hover:bg-violet4 focus:shadow-violet7 absolute top-[10px] right-[10px] inline-flex h-[25px] w-[25px] appearance-none items-center justify-center rounded-full focus:shadow-[0_0_0_2px] focus:outline-none border-1 border-black hover:border-violet11 z-10"
                  aria-label="Close"
                >
                  <Cross2Icon />
                </button>
              </Dialog.Close>
              <a
                className="text-violet11 hover:bg-violet4 focus:shadow-violet7 absolute bottom-[10px] right-[20px] inline-flex h-[25px] w-[25px] appearance-none items-center justify-center rounded-full focus:shadow-[0_0_0_2px] focus:outline-none border-1 border-black hover:border-violet11 cursor-pointer"
                aria-label="Download"
                href={"/certificates/" + image}
                download
              >
                <DownloadIcon />
              </a>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
