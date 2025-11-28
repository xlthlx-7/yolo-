
import React, { useState } from 'react';
import JSZip from 'jszip';
import FileSaver from 'file-saver';
import { Upload, Download, Settings, Camera, Zap, ImageIcon, Loader2, Layers, AlertCircle } from './components/IconComponents';
import { GenerationConfig, LightingCondition, BackgroundType, GeneratedData, ALTITUDE_OPTIONS, ANGLE_OPTIONS, WeatherCondition } from './types';
import { generateDroneView, detectObjectBBox } from './services/geminiService';
import { fileToBase64, resizeImage, convertGeminiBoxToYolo, formatYoloLine, getGeminiAspectRatio } from './utils/yoloUtils';

const App: React.FC = () => {
  // State
  const [apiKey] = useState<string>(process.env.API_KEY || '');
  const [referenceImg, setReferenceImg] = useState<string | null>(null);
  const [objectLabel, setObjectLabel] = useState<string>('car');
  const [classId, setClassId] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedItems, setGeneratedItems] = useState<GeneratedData[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  // Configuration
  const [selectedAngles, setSelectedAngles] = useState<string[]>(['Standard (45°)']);
  const [config, setConfig] = useState<Omit<GenerationConfig, 'angle'> & { angle: string }>({
    count: 3,
    width: 640,
    height: 640,
    lighting: 'Random',
    background: 'Random',
    altitude: 'Random',
    angle: 'Random', // Kept for interface compatibility but we use selectedAngles for logic
    weather: 'Random'
  });

  // Handlers
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const base64 = await fileToBase64(e.target.files[0]);
        setReferenceImg(base64);
      } catch (err) {
        console.error("Upload failed", err);
      }
    }
  };

  const sample = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const toggleAngle = (angle: string) => {
    setSelectedAngles(prev => 
      prev.includes(angle) 
        ? prev.filter(a => a !== angle)
        : [...prev, angle]
    );
  };

  const generateDataset = async () => {
    if (!referenceImg || !apiKey) return;
    if (selectedAngles.length === 0) {
      alert("Please select at least one camera angle.");
      return;
    }
    
    setIsProcessing(true);
    setGeneratedItems([]); // Clear previous
    setProgress({ current: 0, total: config.count });

    // Pre-calculate aspects
    const aspectRatio = getGeminiAspectRatio(config.width, config.height);

    for (let i = 0; i < config.count; i++) {
      // Create a unique ID
      const id = `img_${Date.now()}_${i}`;
      
      // Resolve Random options
      const lighting = config.lighting === 'Random' 
        ? sample(Object.values(LightingCondition)) 
        : config.lighting;

      const background = config.background === 'Random'
        ? sample(Object.values(BackgroundType))
        : config.background;
      
      const altitude = config.altitude === 'Random'
        ? sample(ALTITUDE_OPTIONS)
        : config.altitude;
      
      const weather = config.weather === 'Random'
        ? sample(Object.values(WeatherCondition))
        : config.weather;
      
      // Pick random angle from user selection
      const angle = sample(selectedAngles);
      
      const itemConfig: GenerationConfig = { 
        ...config, 
        lighting,
        background,
        altitude,
        angle,
        weather
      };
      
      const newItem: GeneratedData = {
        id,
        imageUrl: '',
        status: 'generating',
        metadata: {
          lighting: itemConfig.lighting,
          background: itemConfig.background,
          altitude: itemConfig.altitude,
          angle: itemConfig.angle,
          weather: itemConfig.weather
        }
      };
      
      // Add to UI immediately so user sees slot
      setGeneratedItems(prev => [...prev, newItem]);

      try {
        // 1. Generate Image
        const rawDroneImage = await generateDroneView(apiKey, referenceImg, itemConfig, objectLabel, aspectRatio);
        
        // 2. Resize to Target Resolution (Strict requirement for YOLO training)
        const resizedImage = await resizeImage(rawDroneImage, config.width, config.height);
        
        // Update state to show image while detecting
        setGeneratedItems(prev => prev.map(item => 
          item.id === id ? { ...item, imageUrl: resizedImage, status: 'detecting' } : item
        ));

        // 3. Detect Bounding Box
        const box2d = await detectObjectBBox(apiKey, resizedImage, objectLabel);
        const yoloBBox = convertGeminiBoxToYolo(box2d, config.width, config.height);

        // 4. Finalize
        setGeneratedItems(prev => prev.map(item => 
          item.id === id ? { ...item, bbox: yoloBBox, status: 'completed' } : item
        ));

      } catch (err) {
        console.error(`Failed to generate item ${i}`, err);
        setGeneratedItems(prev => prev.map(item => 
          item.id === id ? { ...item, status: 'failed', error: (err as Error).message } : item
        ));
      }

      setProgress({ current: i + 1, total: config.count });
    }

    setIsProcessing(false);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const completedItems = generatedItems.filter(i => i.status === 'completed' && i.bbox);
    
    if (completedItems.length === 0) return;

    const imgFolder = zip.folder("images");
    const labelFolder = zip.folder("labels");
    
    // Support custom class ID in data.yaml using dictionary syntax
    const dataYaml = `
train: ../train/images
val: ../valid/images

nc: ${classId + 1}
names: {${classId}: '${objectLabel}'}
    `;
    zip.file("data.yaml", dataYaml);

    completedItems.forEach((item, index) => {
      // Save Image
      const imgData = item.imageUrl.split(',')[1];
      imgFolder?.file(`${item.id}.jpg`, imgData, { base64: true });

      // Save Label (YOLO Format)
      if (item.bbox && labelFolder) {
        // Use user-defined classId
        const line = formatYoloLine(classId, item.bbox);
        labelFolder.file(`${item.id}.txt`, line);
      }
    });

    const content = await zip.generateAsync({ type: "blob" });
    // Handle file-saver import issue by checking default
    const save = (FileSaver as any).default || FileSaver;
    save.saveAs(content, "yolo_drone_dataset.zip");
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
      {/* LEFT PANEL: CONFIG */}
      <div className="w-full md:w-96 flex-shrink-0 bg-gray-800 border-r border-gray-700 flex flex-col h-full overflow-y-auto z-10 shadow-xl scrollbar-thin scrollbar-thumb-gray-600">
        <div className="p-6 border-b border-gray-700 bg-gray-800 sticky top-0 z-20">
          <h1 className="text-2xl font-bold flex items-center gap-2 text-blue-400">
            <Layers className="w-6 h-6" />
            SkyForge
          </h1>
          <p className="text-xs text-gray-400 mt-1">YOLOv8 Synthetic Data Generator</p>
        </div>

        <div className="p-6 space-y-8 flex-1">
          {/* Reference Image */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-300 flex items-center gap-2">
              <Camera className="w-4 h-4 text-blue-400" />
              1. Reference Object
            </label>
            <div className="relative group">
               <input 
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload}
                className="hidden"
                id="file-upload"
              />
              <label 
                htmlFor="file-upload"
                className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300 
                  ${referenceImg ? 'border-blue-500 bg-gray-900' : 'border-gray-600 hover:border-gray-500 bg-gray-700/50 hover:bg-gray-700'}`}
              >
                {referenceImg ? (
                  <img src={referenceImg} alt="Ref" className="h-full w-full object-contain rounded-lg p-2" />
                ) : (
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 mb-2 text-gray-400" />
                    <p className="text-sm text-gray-500">Click to upload object image</p>
                  </div>
                )}
              </label>
            </div>
            
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">Object Name (Class)</label>
                <input 
                  type="text" 
                  value={objectLabel}
                  onChange={(e) => setObjectLabel(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                  placeholder="e.g., car"
                />
              </div>
              <div className="w-24">
                <label className="block text-xs text-gray-400 mb-1">Class ID</label>
                <input 
                  type="number" 
                  min="0"
                  value={classId}
                  onChange={(e) => setClassId(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
             <label className="block text-sm font-medium text-gray-300 flex items-center gap-2">
              <Settings className="w-4 h-4 text-blue-400" />
              2. Dataset Settings
            </label>

            <div className="grid grid-cols-2 gap-3">
               <div>
                <label className="text-xs text-gray-500 block mb-1">Output Width (px)</label>
                <input 
                  type="number" 
                  value={config.width}
                  onChange={(e) => setConfig({...config, width: parseInt(e.target.value)})}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Output Height (px)</label>
                <input 
                  type="number" 
                  value={config.height}
                  onChange={(e) => setConfig({...config, height: parseInt(e.target.value)})}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                />
              </div>
            </div>

             <div>
                <label className="text-xs text-gray-500 block mb-1">Batch Size (Count)</label>
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={config.count}
                  onChange={(e) => setConfig({...config, count: parseInt(e.target.value)})}
                  className="w-full accent-blue-500 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-right text-xs text-blue-400 font-mono mt-1">{config.count} images</div>
            </div>

            <div className="space-y-4 border-t border-gray-700 pt-4">
              <label className="text-xs text-gray-500 block uppercase tracking-wider font-semibold">Environment Config</label>
              
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Background</label>
                <select 
                  value={config.background}
                  onChange={(e) => setConfig({...config, background: e.target.value})}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300"
                >
                  <option value="Random">🎲 Random (Recommended)</option>
                  {Object.values(BackgroundType).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Drone Altitude</label>
                <select 
                  value={config.altitude}
                  onChange={(e) => setConfig({...config, altitude: e.target.value})}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300"
                >
                  <option value="Random">🎲 Random (Varied Heights)</option>
                  {ALTITUDE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Camera Angles (Multi-select)</label>
                <div className="grid grid-cols-2 gap-2">
                  {ANGLE_OPTIONS.map(opt => {
                    // Extract degree number for display
                    const label = opt.split('(')[1]?.replace(')', '') || opt;
                    const isSelected = selectedAngles.includes(opt);
                    return (
                      <button 
                        key={opt}
                        onClick={() => toggleAngle(opt)}
                        className={`text-xs px-2 py-2 rounded border transition-colors ${
                          isSelected 
                            ? 'bg-blue-600 border-blue-500 text-white' 
                            : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                        }`}
                      >
                         {opt.split(' ')[0]} ({label})
                      </button>
                    )
                  })}
                </div>
                {selectedAngles.length === 0 && <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Select at least one angle</p>}
              </div>

               <div>
                <label className="text-[10px] text-gray-400 block mb-1">Weather & Atmosphere</label>
                <select 
                  value={config.weather}
                  onChange={(e) => setConfig({...config, weather: e.target.value})}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300"
                >
                  <option value="Random">🎲 Random (Mixed Weather)</option>
                  {Object.values(WeatherCondition).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

               <div>
                <label className="text-[10px] text-gray-400 block mb-1">Lighting</label>
                <select 
                  value={config.lighting}
                  onChange={(e) => setConfig({...config, lighting: e.target.value})}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300"
                >
                  <option value="Random">🎲 Random (Varied Time)</option>
                  {Object.values(LightingCondition).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="pt-4 pb-8">
             <button
              onClick={generateDataset}
              disabled={isProcessing || !referenceImg || selectedAngles.length === 0}
              className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-lg
                ${isProcessing || !referenceImg || selectedAngles.length === 0
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/20 active:scale-95'}`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Start Generation
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: GALLERY */}
      <div className="flex-1 flex flex-col h-full bg-gray-900 relative">
        <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-gray-900/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <ImageIcon className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-medium text-gray-200">Generated Assets</h2>
            {generatedItems.length > 0 && (
              <span className="bg-gray-800 text-gray-400 text-xs px-2 py-1 rounded-full border border-gray-700">
                {generatedItems.filter(i => i.status === 'completed').length} / {config.count} Ready
              </span>
            )}
          </div>
          <button
            onClick={handleDownloadZip}
            disabled={generatedItems.filter(i => i.status === 'completed').length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
              ${generatedItems.filter(i => i.status === 'completed').length > 0
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-gray-800 text-gray-600 cursor-not-allowed'}`}
          >
            <Download className="w-4 h-4" />
            Download Dataset (YOLOv8)
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
           {generatedItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-4">
              <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center mb-4 border border-gray-700">
                <Layers className="w-10 h-10 opacity-50" />
              </div>
              <p className="text-lg">No images generated yet.</p>
              <p className="text-sm max-w-md text-center text-gray-600">
                Upload a reference image and configure your drone simulation settings to start creating synthetic training data.
              </p>
            </div>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {generatedItems.map((item) => (
                <div key={item.id} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-blue-500/50 transition-all group relative">
                  <div className="aspect-square bg-gray-900 relative overflow-hidden">
                    {item.imageUrl ? (
                      <>
                        <img src={item.imageUrl} alt="Generated" className="w-full h-full object-cover" />
                        {/* Bounding Box Overlay */}
                        {item.bbox && (
                          <div 
                            className="absolute border-2 border-green-500 bg-green-500/20 pointer-events-none"
                            style={{
                              left: `${(item.bbox.x_center - item.bbox.width/2) * 100}%`,
                              top: `${(item.bbox.y_center - item.bbox.height/2) * 100}%`,
                              width: `${item.bbox.width * 100}%`,
                              height: `${item.bbox.height * 100}%`
                            }}
                          >
                             <span className="absolute -top-5 left-0 text-[10px] bg-green-500 text-black px-1 font-bold">
                               {objectLabel} (ID: {classId})
                             </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                      </div>
                    )}
                    
                    {/* Status Badge */}
                    <div className="absolute top-2 right-2">
                       {item.status === 'completed' && <span className="w-2 h-2 bg-green-500 rounded-full block shadow-lg shadow-green-500/50"></span>}
                       {item.status === 'failed' && <span className="w-2 h-2 bg-red-500 rounded-full block"></span>}
                       {(item.status === 'generating' || item.status === 'detecting') && <span className="w-2 h-2 bg-yellow-500 rounded-full block animate-pulse"></span>}
                    </div>
                  </div>
                  
                  <div className="p-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-gray-400 font-mono">{item.id.slice(-6)}</span>
                      <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded
                        ${item.status === 'completed' ? 'bg-green-900 text-green-300' : 
                          item.status === 'failed' ? 'bg-red-900 text-red-300' : 
                          'bg-blue-900 text-blue-300'}`}>
                        {item.status}
                      </span>
                    </div>
                    {item.error ? (
                      <p className="text-xs text-red-400 mt-1 line-clamp-2">{item.error}</p>
                    ) : (
                      <div className="text-[10px] text-gray-500 space-y-0.5">
                        <p className="truncate">H: {item.metadata.altitude}</p>
                        <p className="truncate">∠: {item.metadata.angle}</p>
                        <p className="truncate">W: {item.metadata.weather}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
             </div>
           )}
        </main>
      </div>
    </div>
  );
};

export default App;
