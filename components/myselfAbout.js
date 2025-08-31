import React from 'react'
import Image from 'next/image';

const MyselfAbout = () => {
  return (
    <>
    <section className="min-h-screen grid grid-cols-4 lg:grid-cols-12 gap-14 max-w-screen-xl mx-auto py-10 px-7 md:px-16 relative" id="upcoming" data-aos="fade-up">
  <div className="col-span-4 lg:col-span-5 ">
    <div className="relative h-full" data-aos="zoom-in" data-aos-delay="100">
      <Image width={700} height={1000} objectFit='cover' src="https://images.unsplash.com/photo-1519834785169-98be25ec3f84?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=464&q=80" alt="Leslie Alexander" className="w-full rounded-xl shadow-md md:rounded-2xl md:shadow-lg h-48 md:h-72 lg:h-full object-cover" />
      <div className="absolute bottom-0 text-white bg-gradient-to-b from-transparent to-gray-700 rounded-2xl h-auto p-5 md:p-10">
        <span className="mb-2 inline-block text-sm font-bold text-white">Alan Turing</span>
        <p className="text-sm leading-relaxed">“Sometimes it is the people no one imagines anything of who do the things that no-one can imagine.”</p>
      </div>
    </div>
  </div>
  <div className="col-span-4 lg:col-span-7 flex flex-col justify-center">
    <span className="inline-block mb-3 uppercase text-sm tracking-wide font-medium text-gray-900">About</span>
    <h1 className="text-4xl md:text-5xl md:leading-tight font-bold text-gray-900 xl:max-w-full">What do I think about <span className="text-blue-600">upcoming 5</span> Years</h1>
    <div className="grid gap-10 lg:max-w-xl pt-10 md:pt-14">
      <div className="sm:flex gap-6 items-center" data-aos="zoom-in-down" data-aos-delay="200">
        <Image width={200} height={200} objectFit='cover' src="https://images.unsplash.com/photo-1579403124614-197f69d8187b?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxzZWFyY2h8MTB8fGRldmVsb3BtZW50fGVufDB8fDB8fA%3D%3D&auto=format&fit=crop&w=500&q=60" alt="Development" className="w-24 h-24 object-cover rounded-2xl flex-none" />
        <div>
          <span className="mb-2 inline-block text-sm font-light mt-5 sm:mt-0">Development</span>
          <p className="text-sm leading-relaxed font-semibold text-gray-900">“I am currently working on some projects in web development and applications development. It upgrades my designing skills too.”</p>
        </div>
      </div>
      <div className="sm:flex gap-6 items-center border-t border-gray-200 pt-12 sm:border-0 sm:pt-0" data-aos="zoom-in-down" data-aos-delay="250">
        <Image width={200} height={200} objectFit='cover' src="https://images.unsplash.com/photo-1553933899-131780ba04a3?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=386&q=80" alt="Machine Learning" className="w-24 h-24 object-cover rounded-2xl flex-none" />
        <div>
          <span className="mb-2 inline-block text-sm font-light mt-5 sm:mt-0">Cloud Learning</span>
          <p className="text-sm leading-relaxed font-semibold text-gray-900">“For a long time, i am try to learn more about cloud engineering and cloud native architecture. i have working on cloud learning projects.”</p>
        </div>
      </div>
      <div className="sm:flex gap-6 items-center border-t border-gray-200 pt-12 sm:border-0 sm:pt-0" data-aos="zoom-in-down" data-aos-delay="300">
        <Image width={200} height={200} objectFit='cover' src="https://images.unsplash.com/photo-1542744173-8e7e53415bb0?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=870&q=80" alt="job/internship" className="w-24 h-24 object-cover rounded-2xl flex-none" />
        <div>
          <span className="mb-2 inline-block text-sm font-light mt-5 sm:mt-0">Job / Internship</span>
          <p className="text-sm leading-relaxed font-semibold text-gray-900">“Now days, I am finding a job or an internship. It may help me to get how to work in an industry. Then i got exprience to achieve more.</p>
        </div>
      </div>
    </div>
  </div>
</section></>
  )
}

export default MyselfAbout