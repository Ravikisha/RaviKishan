import Image from "next/image";
import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { badgeColorGenerator } from "./utils/utils";
import TimeIcon from "../public/assets/time.jpg";

const Articles = () => {
  const [articles, setArticles] = useState([]);
  const DEV_URL = "https://dev.to/api/articles?username=ravikishan";

  function formatDate(dateString) {
    // Create a Date object from the input date string
    var date = new Date(dateString);

    // Month names array
    var monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    // Extract day, month, and year components
    var day = date.getUTCDate();
    var monthIndex = date.getUTCMonth();
    var year = date.getUTCFullYear();

    // Format the date components into the desired format
    var formattedDate = day + "-" + monthNames[monthIndex] + "-" + year;

    return formattedDate;
  }

  useEffect(() => {
    fetch(DEV_URL)
      .then((res) => res.json())
      .then((data) => {
        setArticles(data);
      });
  }, []);

  return (
    <>
      <div className="PL__container" data-aos="fade-up" data-aos-delay="100" id="articles">
        <h2 className="text-4xl font-bold mb-2 text-center">Articles</h2>
        <h2 className="text-2xl mb-2 text-center">
          See what i write about{" "}
          <span className="text-sky-500 font-bold text-3xl underline">
            programming
          </span>
        </h2>
        <motion.div>
          <AnimatePresence>
            <div className="PL__content">
              {articles.map((article) => (
                <div
                  key={article.id}
                  data-aos="zoom-in-up"
                  className="px-4 md:px-0"
                >
                  <div className="relative flex max-w-[24rem] flex-col overflow-hidden rounded-xl bg-white bg-clip-border text-gray-700 shadow-md">
                    <div className="relative m-0 overflow-hidden text-gray-700 bg-transparent rounded-none shadow-none bg-clip-border">
                      <Image
                        src={article.cover_image}
                        alt={article.title}
                        width={600}
                        height={400}
                        objectFit="contain"
                      />
                    </div>
                    <div className="p-4 flex gap-2 flex-col justify-start items-start">
                      <h4
                        className="block text-xl antialiased font-semibold leading-snug tracking-normal text-blue-gray-900"
                        style={{ fontFamily: "Playfair Display" }}
                      >
                        {article.title}
                      </h4>
                      <p
                        className="block text-sm antialiased font-normal leading-relaxed text-gray-700 overflow-auto"
                        style={{ fontFamily: "Raleway" }}
                      >
                        {article.description}
                      </p>
                      <div className="flex items-center flex-wrap gap-2">
                        {article.tag_list.map((tag) => (
                          <span
                            key={tag}
                            className={`text-sm font-medium me-2 px-2.5 py-0.5 rounded ${badgeColorGenerator()}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center space-x-2">
                        <Image src={TimeIcon} width={20} height={20} alt="Published At" />
                        <span className="text-sm text-gray-700">
                          {formatDate(article.published_at)}
                        </span>
                      </div>
                    </div>
                    <button
                      className="shadow-blackA4 hover:bg-sky-700 inline-flex items-center justify-center rounded-[4px] bg-sky-500 text-white p-4 font-medium leading-none shadow-[0_2px_10px] focus:shadow-[0_0_0_2px] focus:shadow-black focus:outline-none"
                      onClick={() => window.open(article.url, "_blank")}
                    >
                      Read More
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
};

export default Articles;
