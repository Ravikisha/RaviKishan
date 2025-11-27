import React, { useState } from "react";

const Qualification = () => {
  const [toggleQualification, setToggleQualification] = useState(1);

  const toggleTab = (index) => {
    setToggleQualification(index);
  };
  return (
    <>
        <h2 className="p-10 text-5xl font-bold text-center text-white dark:text-gray-800 bg-sky-500 dark:bg-purple-600 transition-colors duration-300">
          Qualification
        </h2>
      <section className="qualification section p-4 bg-white dark:bg-gray-900 transition-colors duration-300 h-1/2 flex flex-col gap-2 align-center justify-center" id="qualification" data-aos="fade-in" data-aos-delay="100">
        <div className="qualification__container container__mod">
          <div className="qualification__tabs">
            <div
              className={
                toggleQualification === 1
                  ? "qualification__button qualification__active button--flex text-gray-700 dark:text-gray-100 transition-colors duration-300"
                  : "qualification__button button--flex text-gray-700 dark:text-gray-300 transition-colors duration-300"
              }
              onClick={()=>toggleTab(1)}
            >
              <i className="uil uil-graduation-cap qualification__icon mx-3 text-purple-600 dark:text-purple-400"></i>
              Education
            </div>
            <div className={
                toggleQualification === 2
                  ? "qualification__button qualification__active button--flex text-gray-700 dark:text-gray-100 transition-colors duration-300"
                  : "qualification__button button--flex text-gray-700 dark:text-gray-300 transition-colors duration-300"
              }
              onClick={()=>toggleTab(2)}
              >
              <i className="uil uil-briefcase-alt qualification__icon mx-3 text-purple-600 dark:text-purple-400"></i>
              Experience
            </div>
          </div>
        </div>  
        <div className="qualification__sections">
          <div className={toggleQualification === 1 ? "qualification__content qualification__content-active" : "qualification__content"}>
          <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="125">
              <div></div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
              <div>
                <h3 className="qualification__title dark:text-gray-300">MCA</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  Vellore Institute of Technology, Vellore
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> 2024 - 26 <br />
                  <i className="uil uil-graduation-cap"></i> 9.1 CGPA (Current)
                </div>
              </div>
            </div>
            <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="100">
              <div>
                <h3 className="qualification__title dark:text-gray-300">BCA</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  Prestige Institute of Management & Research - Gwalior
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> 2021 - 2024 <br />
                  <i className="uil uil-graduation-cap"></i> 9.6 CGPA
                </div>
              </div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
            </div>

            <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="125">
              <div></div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
              <div>
                <h3 className="qualification__title dark:text-gray-300">Intermediate</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  BSEB - Patna
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> 2019 - 2021 <br />
                  <i className="uil uil-graduation-cap"></i> 74.3 %
                </div>
              </div>
            </div>
            <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="150">
              <div>
                <h3 className="qualification__title dark:text-gray-300">Matriculation</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  BSEB - Patna
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> 2018 - 2019 <br />
                  <i className="uil uil-graduation-cap"></i> 83.2 %
                </div>
              </div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
            </div>
          </div>
          <div className={toggleQualification === 2 ? "qualification__content qualification__content-active" : "qualification__content"}>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title dark:text-gray-300">Quant Developer Intern</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  Arrowhead Captial Management LLP - Mumbai
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> Jun 2025 - Present
                </div>
              </div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
            </div>
            <div className="qualification__data">
              <div></div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
              <div>
                <h3 className="qualification__title dark:text-gray-300">Freelance Developer</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  Upwork | Offline Clients
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> Jan 2022 - Jun 2025
                </div>
              </div>
            </div>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title dark:text-gray-300">Full Stack Developer Intern</h3>
                <span className="qualification__subtitle dark:text-gray-300">
                  ChitiInfotech Pvt. Ltd. - Gwalior
                </span>
                <div className="qualification__calendar dark:text-gray-300">
                  <i className="uil uil-calendar-alt"></i> Jan 2023 - Sep 2023
                </div>
              </div>
              <div>
                <span className="qualification__rounded dark:text-gray-300"></span>
                <span className="qualification__line dark:text-gray-300"></span>
              </div>
            </div>
            

            
            
            {/* <h2 className="mt-5 text-center text-4xl font-bold">No Experince <span className="text-sky-500">Now !</span></h2> */}
          </div>
        </div>
      </section>
    </>
  );
};

export default Qualification;
