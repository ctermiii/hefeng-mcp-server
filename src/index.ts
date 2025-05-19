#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// 和风天气 API 的基础 URL 和 API 密钥
let HEFENG_WEATHER_API_URL = ""; // 天气 API 基础 URL，默认为空
let HEFENG_GEO_API_URL = ""; // 地理位置 API 基础 URL，默认为空
let HEFENG_API_KEY = "";

// 从命令行参数读取 API 密钥
const apiKeyArg = process.argv.find(arg => arg.startsWith('--apiKey='));
if (apiKeyArg) {
    const apiKey = apiKeyArg.split('=')[1];
    if (apiKey) {
        console.log(`使用命令行参数中的API密钥: ${apiKey}`);
        HEFENG_API_KEY = apiKey;
    }
}

// 从命令行参数读取 API URL (用于天气和地理位置API)
const apiUrlArg = process.argv.find(arg => arg.startsWith('--apiUrl='));
if (apiUrlArg) {
    const apiUrl = apiUrlArg.split('=')[1];
    if (apiUrl) {
        console.log(`使用命令行参数中的 API URL: ${apiUrl}`);
        HEFENG_WEATHER_API_URL = apiUrl;
        HEFENG_GEO_API_URL = apiUrl; // GEO API 也使用相同的 URL
    }
}

if (!HEFENG_API_KEY) {
    console.warn("警告: 未提供 HEFENG_API_KEY。API 调用可能会失败。请使用 --apiKey=<你的密钥> 参数提供。");
}
if (!HEFENG_WEATHER_API_URL) { // 如果天气API URL为空
    console.warn("警告: 未提供 HEFENG_WEATHER_API_URL (天气API基础URL)。天气 API 调用可能会失败。请使用 --apiUrl=<API基础URL> 参数提供。");
}
if (!HEFENG_GEO_API_URL) { // 如果地理位置API URL为空 (理论上它会和天气API URL一致或都为空)
    console.warn("警告: 未配置 HEFENG_GEO_API_URL (地理位置API基础URL)。城市ID查询功能可能受影响。请使用 --apiUrl=<API基础URL> 参数提供。");
}


// 定义城市信息查询参数的 Zod schema
const LocationIdArgumentsSchema = z.object({
    city_name: z.string().describe("需要查询的城市名称，例如：北京、London"),
});

// 定义天气查询参数的 Zod schema
const WeatherArgumentsSchema = z.object({
    location: z.string().describe("城市名称（例如：北京）、逗号分隔的经纬度信息 (例如：116.40,39.90) 或 和风天气的 Location ID。"),
    days: z.enum(['now', '24h', '72h', '168h', '3d', '7d', '10d', '15d', '30d']).default('now').describe("预报类型。now:实时天气, 24h/72h/168h:逐小时预报, 3d/7d/10d/15d/30d:逐天预报"),
});

// 创建服务器实例
const server = new Server(
    {
        name: "hefeng-weather-server",
        version: "1.2.5", // 版本更新
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// 列出可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get-weather",
                description: "获取中国国内或国际城市的天气预报",
                inputSchema: {
                    type: "object",
                    properties: {
                        location: {
                            type: "string",
                            description: "城市名称（例如：北京 , beijing）、逗号分隔的经纬度信息 (例如：116.40,39.90) 或 和风天气的 Location ID。天气API支持直接使用城市名进行模糊搜索。",
                        },
                        days: {
                            type: "string",
                            enum: ["now", "24h", "72h", "168h", "3d", "7d", "10d", "15d", "30d"],
                            description: "预报类型。now:实时天气, 24h/72h/168h:逐小时预报, 3d/7d/10d/15d/30d:逐天预报",
                            default: "now"
                        }
                    },
                    required: ["location"],
                },
            },
            {
                name: "get_location_id",
                description: "根据城市名称获取其精确的位置ID、经纬度等详细地理信息",
                inputSchema: {
                    type: "object",
                    properties: {
                        city_name: {
                            type: "string",
                            description: "需要查询的城市名称，例如：北京、London",
                        },
                    },
                    required: ["city_name"],
                },
            }
        ],
    };
});

// 和风天气 API 响应体接口定义
interface HeFengLocation {
    name: string;
    id: string;
    lat: string;
    lon: string;
    adm2: string; 
    adm1: string; 
    country: string; 
    tz?: string;
    utcOffset?: string;
    isDst?: string;
    type?: string;
    rank?: string;
    fxLink?: string;
}

interface HeFengCityLookupResponse {
    code: string; 
    location?: HeFengLocation[];
    refer?: {
        sources: string[];
        license: string[];
    };
}

interface HeFengWeatherNowResponse {
    code: string;
    now?: {
        obsTime: string;
        temp: string;
        feelsLike: string;
        text: string;
        windDir: string;
        windScale: string;
        humidity: string;
        precip: string;
        pressure: string;
        vis: string;
        cloud?: string;
        dew?: string;
    };
    refer?: { 
        sources: string[];
        license: string[];
    };
}

interface HeFengWeatherDailyResponse {
    code: string;
    daily?: Array<{
        fxDate: string;
        tempMax: string;
        tempMin: string;
        textDay: string;
        textNight: string;
        windDirDay: string;
        windScaleDay: string;
        windDirNight: string;
        windScaleNight: string;
        humidity: string;
        precip: string;
        pressure: string;
        vis: string;
        uvIndex: string;
        sunrise?: string;
        sunset?: string;
    }>;
    refer?: { 
        sources: string[];
        license: string[];
    };
}

interface HeFengWeatherHourlyResponse {
    code: string;
    hourly?: Array<{
        fxTime: string;
        temp: string;
        text: string;
        windDir: string;
        windScale: string;
        humidity: string;
        pop?: string; 
        precip?: string;
        pressure?: string;
        cloud?: string;
        dew?: string;
    }>;
    refer?: { 
        sources: string[];
        license: string[];
    };
}

// 辅助函数：执行和风天气 API 请求
async function makeHeFengRequest<T>(baseUrl: string, path: string, params: Record<string, string>): Promise<T | null> {
    if (!HEFENG_API_KEY) {
        console.error("错误: HEFENG_API_KEY 未设置。");
        return { code: "500", error: "API Key not configured" } as any; 
    }
    if (!baseUrl) { // 检查 baseUrl 是否为空
        console.error(`错误: API 基础 URL (${baseUrl === HEFENG_WEATHER_API_URL ? '天气API' : '地理位置API'}) 未设置。`);
        return { code: "500", error: "API Base URL not configured" } as any;
    }
    
    const queryParams = new URLSearchParams({
        ...params,
        key: HEFENG_API_KEY, // API Key 作为查询参数
    });
    
    const fullUrl = `${baseUrl}${path}?${queryParams.toString()}`;
    // 在日志中隐藏API Key的值
    const paramsForLog = { ...params };
    const queryParamsForLog = new URLSearchParams(paramsForLog);
    console.log(`发起请求: ${baseUrl}${path}?${queryParamsForLog.toString()}&key=YOUR_API_KEY`);


    try {
        const response = await fetch(fullUrl);
        if (!response.ok) {
            console.error(`HTTP 错误! 状态: ${response.status}, URL (key已隐藏): ${baseUrl}${path}?${queryParamsForLog.toString()}&key=YOUR_API_KEY`);
            const errorBody = await response.text();
            console.error(`错误详情: ${errorBody}`);
            try {
                const hefengError = JSON.parse(errorBody) as {code?: string, message?: string};
                if (hefengError.code) {
                     return { code: hefengError.code, error: `HeFeng API Error: ${hefengError.message || errorBody}` } as any;
                }
            } catch (e) {
                // 不是JSON错误，继续抛出通用HTTP错误
            }
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
        }
        const data = (await response.json()) as T & { code?: string };
        if (data.code && data.code !== "200") {
            console.error(`和风 API 错误! Code: ${data.code}, URL (key已隐藏): ${baseUrl}${path}?${queryParamsForLog.toString()}&key=YOUR_API_KEY`);
        }
        return data;
    } catch (error) {
        console.error(`和风 API 请求 (${baseUrl}${path}) 出错:`, error);
        if (error instanceof Error && (error as any).code) {
             return { code: (error as any).code, message: error.message } as any;
        }
        return { code: "FETCH_ERROR", message: error instanceof Error ? error.message : String(error) } as any;
    }
}

// 辅助函数：根据城市名称获取位置信息 (Location ID, 经纬度)
async function fetchLocationDetailsByName(cityName: string): Promise<HeFengLocation | null> {
    if (!HEFENG_GEO_API_URL) { // 在调用前检查 GEO API URL 是否已设置
        console.error("错误：地理位置API基础URL (HEFENG_GEO_API_URL) 未配置。");
        return null;
    }
    const response = await makeHeFengRequest<HeFengCityLookupResponse>(
        HEFENG_GEO_API_URL, // 使用 HEFENG_GEO_API_URL
        "/v2/city/lookup",
        { location: cityName }
    );

    if (response && response.code === "200" && response.location && response.location.length > 0) {
        return response.location[0]; 
    }
    if (response && response.code !== "200") {
        console.error(`城市查询API错误: ${response.code} for city ${cityName}. Message: ${(response as any).message || (response as any).error}`);
    }
    return null;
}


// 处理工具执行
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_location_id") {
            const { city_name } = LocationIdArgumentsSchema.parse(args);
            if (!HEFENG_GEO_API_URL) { 
                 return {
                    content: [{ type: "text", text: "错误：地理位置API基础URL未配置。请管理员使用 --apiUrl 配置。" }],
                };
            }
            const locationDetails = await fetchLocationDetailsByName(city_name);

            if (!locationDetails) {
                return {
                    content: [{ type: "text", text: `无法找到城市 "${city_name}" 的位置信息。请检查城市名称或API配置。` }],
                };
            }
            const { id, name: locName, lat, lon, adm1, adm2, country } = locationDetails;
            const resultText = `城市: ${locName}\n` +
                               `所属区域: ${adm2 || 'N/A'}, ${adm1 || 'N/A'}, ${country || 'N/A'}\n` +
                               `Location ID: ${id}\n` +
                               `纬度: ${lat}\n` +
                               `经度: ${lon}`;
            return { content: [{ type: "text", text: resultText }] };

        } else if (name === "get-weather") {
            if (!HEFENG_WEATHER_API_URL) {
                 return {
                    content: [{ type: "text", text: "错误：天气API基础URL未配置。请管理员使用 --apiUrl 配置。" }],
                };
            }
            const { location: rawLocationInput, days } = WeatherArgumentsSchema.parse(args);
            const effectiveLocation = rawLocationInput; 
            const displayLocation = rawLocationInput; 

            let weatherPath = "";
            if (days === 'now') {
                weatherPath = "/v7/weather/now";
            } else if (['24h', '72h', '168h'].includes(days)) {
                weatherPath = `/v7/weather/${days}`;
            } else { 
                weatherPath = `/v7/weather/${days}`;
            }
            
            const weatherData = await makeHeFengRequest<HeFengWeatherNowResponse | HeFengWeatherHourlyResponse | HeFengWeatherDailyResponse>(
                HEFENG_WEATHER_API_URL, // 使用 HEFENG_WEATHER_API_URL
                weatherPath,
                { location: effectiveLocation }
            );

            if (!weatherData || weatherData.code !== "200") {
                 const apiErrorCode = weatherData?.code || "N/A";
                 const errorMessage = (weatherData as any)?.message || (weatherData as any)?.error || "未能获取数据，请检查地点名称或API配置。";
                return {
                    content: [{ type: "text", text: `无法获取 ${displayLocation} 的天气数据 (API Code: ${apiErrorCode}). ${errorMessage}` }],
                };
            }

            if (days === 'now' && 'now' in weatherData && weatherData.now) {
                const { now } = weatherData as HeFengWeatherNowResponse;
                const weatherText = `地点: ${displayLocation}\n` +
                    `观测时间: ${now.obsTime}\n` +
                    `天气: ${now.text}\n` +
                    `温度: ${now.temp}°C\n` +
                    `体感温度: ${now.feelsLike}°C\n` +
                    `风向: ${now.windDir}\n` +
                    `风力: ${now.windScale}级\n` +
                    `相对湿度: ${now.humidity}%\n` +
                    `当前小时累计降水量: ${now.precip}mm\n` +
                    `大气压强: ${now.pressure}hPa\n` +
                    `能见度: ${now.vis}公里`;
                return { content: [{ type: "text", text: weatherText }] };
            } else if (['24h', '72h', '168h'].includes(days) && 'hourly' in weatherData && weatherData.hourly) {
                const { hourly } = weatherData as HeFengWeatherHourlyResponse;
                 if (!hourly || hourly.length === 0) {
                    return { content: [{ type: "text", text: `无法获取 ${displayLocation} 的逐小时预报，或该地区无此项数据。` }] };
                }
                const hoursText = hourly.map(hour => {
                    return `时间: ${hour.fxTime}\n` +
                        `  天气: ${hour.text}, 温度: ${hour.temp}°C\n` +
                        `  湿度: ${hour.humidity}%, 降水概率: ${hour.pop || 'N/A'}%\n` +
                        `  风向: ${hour.windDir} ${hour.windScale}级\n` +
                        `------------------------`;
                }).join('\n');
                return {
                    content: [{
                        type: "text",
                        text: `地点: ${displayLocation}\n${days}小时预报:\n${hoursText}`
                    }],
                };
            } else if ('daily' in weatherData && weatherData.daily) { 
                const { daily } = weatherData as HeFengWeatherDailyResponse;
                 if (!daily || daily.length === 0) {
                    return { content: [{ type: "text", text: `无法获取 ${displayLocation} 的 ${days} 天气预报，或该地区无此项数据。` }] };
                }
                const forecastText = daily.map(day => {
                    return `日期: ${day.fxDate} (日出: ${day.sunrise || 'N/A'}, 日落: ${day.sunset || 'N/A'})\n` +
                        `  白天天气: ${day.textDay}, 夜间天气: ${day.textNight}\n` +
                        `  最高温度: ${day.tempMax}°C, 最低温度: ${day.tempMin}°C\n` +
                        `  相对湿度: ${day.humidity}%, 降水量: ${day.precip}mm\n` +
                        `  白天风向: ${day.windDirDay} ${day.windScaleDay}级\n` +
                        `  夜间风向: ${day.windDirNight} ${day.windScaleNight}级\n` +
                        `  紫外线指数: ${day.uvIndex}\n` +
                        `------------------------`;
                }).join('\n');
                return {
                    content: [{
                        type: "text",
                        text: `地点: ${displayLocation}\n${days}预报:\n${forecastText}`
                    }],
                };
            } else {
                 return { content: [{ type: "text", text: `获取 ${displayLocation} 的天气数据格式不正确或不完整。 (Code: ${weatherData.code})` }] };
            }

        } else {
            throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("参数校验错误:", error.errors);
            throw new Error(
                `输入参数无效: ${error.errors
                    .map((e) => `${e.path.join(".")}: ${e.message}`)
                    .join(", ")}`
            );
        }
        console.error(`工具 "${name}" 执行出错:`, error);
        return {
            content: [{ type: "text", text: `执行工具 "${name}" 时发生内部错误: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
});

// 启动服务器
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Weather-zhcn-plus MCP Server running on stdio. Waiting for requests...");
}

main().catch((error) => {
    console.error("主程序发生严重错误:", error);
    process.exit(1);
});

