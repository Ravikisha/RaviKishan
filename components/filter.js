import React,{useEffect} from 'react';

const Filter = ({popular,setFiltered,activeFilter,setActiveFilter}) => {
    useEffect(() => {
        if(activeFilter === "All"){
            setFiltered(popular);
        }else{
            setFiltered(popular.filter(PL => {
                return PL.tags.includes(activeFilter)
        }));
        }
    },[activeFilter]);
  return (
    <>
        <div className="flex justify-center align-center my-10 gap-4 flex-wrap px-2 md:px-0">
            <button onClick={()=>setActiveFilter('All')} className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500 ${activeFilter === 'All' ? 'bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
                All
            </button>
            <button onClick={()=>setActiveFilter('PL')} className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'PL' ? 'bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            Programming Language
            </button>
            <button onClick={()=>setActiveFilter('frontend')} className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'frontend' ? 'bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            Frontend
            </button>
            <button onClick={()=>setActiveFilter('backend')}className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'backend' ? ' bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            Backend
            </button>
            <button onClick={()=>setActiveFilter('app')}className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'app' ? ' bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            App Developement
            </button>
            <button onClick={()=>setActiveFilter('devops')}className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'devops' ? ' bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            DevOps/Cloud
            </button>
            <button onClick={()=>setActiveFilter('aiml')}className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'aiml' ? ' bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            AI/ML/DS
            </button>
            <button onClick={()=>setActiveFilter('others')}className={`hover:bg-teal-100 bg-white text-teal-800 rounded-full py-3 px-8 shadow-md hover:shadow-2xl transition duration-500  ${activeFilter === 'others' ? ' bg-black text-gray-100 hover:text-gray-100 hover:bg-black font-bold' : ''}`}>
            Others
            </button>
        </div>
    </>
  )
}

export default Filter