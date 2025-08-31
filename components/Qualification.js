import React, { useState } from "react";

const Qualification = () => {
  const [toggleQualification, setToggleQualification] = useState(1);

  const toggleTab = (index) => {
    setToggleQualification(index);
  };
  return (
    <>
      <section className="qualification section p-4" id="qualification" data-aos="fade-in" data-aos-delay="100">
        <h2 className="section__title text-4xl md:text-5xl font-bold text-center text-gray-800 mb-5 ">
          Qualification
        </h2>
        <span className="section__subtitle text-xl md:text-2xl">
          My Personal Journey
        </span>
        <div className="qualification__container container__mod">
          <div className="qualification__tabs">
            <div
              className={
                toggleQualification === 1
                  ? "qualification__button qualification__active button--flex"
                  : "qualification__button  button--flex"
              }
              onClick={()=>toggleTab(1)}
            >
              <i className="uil uil-graduation-cap qualification__icon mx-3"></i>
              Education
            </div>
            <div className={
                toggleQualification === 2
                  ? "qualification__button qualification__active button--flex"
                  : "qualification__button  button--flex"
              }
              onClick={()=>toggleTab(2)}
              >
              <i className="uil uil-briefcase-alt qualification__icon mx-3"></i>
              Experience
            </div>
          </div>
        </div>  
        <div className="qualification__sections">
          <div className={toggleQualification === 1 ? "qualification__content qualification__content-active" : "qualification__content"}>
          <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="125">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">MCA</h3>
                <span className="qualification__subtitle">
                  Vellore Institute of Technology, Vellore
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2024 - 26 <br />
                  <i className="uil uil-graduation-cap"></i> 9.1 CGPA (Current)
                </div>
              </div>
            </div>
            <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="100">
              <div>
                <h3 className="qualification__title">BCA</h3>
                <span className="qualification__subtitle">
                  Prestige Institute of Management & Research - Gwalior
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2021 - 2024 <br />
                  <i className="uil uil-graduation-cap"></i> 9.6 CGPA
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>

            <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="125">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">Intermediate</h3>
                <span className="qualification__subtitle">
                  BSEB - Patna
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2019 - 2021 <br />
                  <i className="uil uil-graduation-cap"></i> 74.3 %
                </div>
              </div>
            </div>
            <div className="qualification__data" data-aos="zoom-in-up" data-aos-delay="150">
              <div>
                <h3 className="qualification__title">Matriculation</h3>
                <span className="qualification__subtitle">
                  BSEB - Patna
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> 2018 - 2019 <br />
                  <i className="uil uil-graduation-cap"></i> 83.2 %
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>
          </div>
          <div className={toggleQualification === 2 ? "qualification__content qualification__content-active" : "qualification__content"}>
            <div className="qualification__data">
              <div>
                <h3 className="qualification__title">Full Stack Developer Intern</h3>
                <span className="qualification__subtitle">
                  ChitiInfotech Pvt. Ltd. - Gwalior
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> Jan 2023 - Sep 2023
                </div>
              </div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
            </div>
            <div className="qualification__data">
              <div></div>
              <div>
                <span className="qualification__rounded"></span>
                <span className="qualification__line"></span>
              </div>
              <div>
                <h3 className="qualification__title">Freelance Developer</h3>
                <span className="qualification__subtitle">
                  Upwork | Offline Clients
                </span>
                <div className="qualification__calendar">
                  <i className="uil uil-calendar-alt"></i> Jan 2022 - Present
                </div>
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
