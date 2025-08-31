import React, { useState, useEffect } from "react";
import { AiFillEye, AiFillGithub } from "react-icons/ai";
import { AnimatePresence, motion } from "framer-motion";
import { data } from "./data_pl";
import Card from './card'; 
import Filter from "./filter";

const Languages = () => {
    const [PLData, setPLData] = useState(data);
    const [filterData, setFilterData] = useState(data);
    const [activeFilter, setActiveFilter] = useState("All");
    
  return(
    <>
    <div className="PL__container" data-aos="fade-up" data-aos-delay="100" id="PL">
    <h2 className="text-4xl font-bold mb-2 text-center">Skills</h2>
    <h2 className="text-2xl mb-2 text-center">See what i know about <span className="text-sky-500 font-bold text-3xl underline">programming</span></h2>
        <Filter popular={PLData} setFiltered={setFilterData} activeFilter={activeFilter} setActiveFilter={setActiveFilter}/>
        <motion.div >
            <AnimatePresence>
                <div className="PL__content">
            {filterData.filter((PL) => PL.show === undefined || PL.show === true ).map((PL) => {
                return(
                    <div key={PL.name} data-aos="zoom-in-up">
                        <Card PL={PL}/>
                    </div>
                )
            }
            )};
            </div>
            </AnimatePresence>
        </motion.div>
    </div>
    
    </>
  )
};

export default Languages;
