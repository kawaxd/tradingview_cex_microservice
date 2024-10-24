type TradeSide = 'Long' | 'Short';
type BodyMessage = 'TP' | 'BE';
import {mexc, type Position} from 'ccxt';
import { serve } from 'bun'

interface SymbolFlags {
    long5Min?: boolean;
    short5Min?: boolean;
    inTrade?: boolean;
    tradeInfo?: any;
}

const mexcAccount = new mexc({
    apiKey: process.env.API_KEY,
    secret: process.env.SECRET,
    enableRateLimit: true,
})

class TradingServer {
    private symbolFlags: { [symbol: string]: SymbolFlags } = {};

    constructor(private port: number) {
        this.startServer();
    }

    private async fetchAndLogBalance() {
        try {
            const balance = await mexcAccount.fetchBalance({ type: 'swap' });
            
            console.log('Futures Account Balance:');
            //@ts-expect-error
            console.log(`Total USDT: ${balance.total['USDT']}`);   console.log(`Free USDT: ${balance.free['USDT']}`);  console.log(`Used USDT: ${balance.used['USDT']}`);
          
            const positions = await mexcAccount.fetchPositions();
            console.log('Current Positions:');
            console.log(positions);
            
            return balance;
        } catch (error) {
            console.error('Error fetching balance:', error);
            throw error;
        }
    }

    private async startServer() {
        console.log(`Server started on port ${this.port}`);
        await this.fetchAndLogBalance();
        serve({
            port: this.port,
            fetch: this.handleRequest.bind(this)
        });
    }

    private async handleRequest(req: Request): Promise<Response> {
        if (req.method !== "POST" || req.url !== "/tradingview/meanreversion") {
            return new Response('Not Found', { status: 404 });
        }
    
        try {
            const positions = await mexcAccount.fetchPositions();
            const body = await req.json();
            
            const SYMBOL: string = body.symbol?.split('.')[0];
            if (!SYMBOL) {
                return new Response('Invalid symbol', { status: 400 });
            }
    
            const BODY_MESSAGE: BodyMessage = body.message;
            
            if (!this.symbolFlags[SYMBOL]?.inTrade) {
                return new Response('No active trade for symbol', { status: 400 });
            }
    
            const cryptoName = SYMBOL.split('USDT')[0];
            const position = positions.find((pos) => pos.symbol.includes(cryptoName));
    
            if (!position) {
                return new Response('No position found', { status: 404 });
            }
    
            switch (BODY_MESSAGE) {
                case 'TP':
                    await this.handleTakeProfit(SYMBOL, position);
                    break;
                case 'BE':
                    await this.handleBreakEven(SYMBOL, position);
                    break;
                default:
                    return new Response('Invalid message type', { status: 400 });
            }
    
            return new Response('Request handled successfully');
        } catch (error) {
            console.error('Error handling request:', error);
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }
    
    private async handleTakeProfit(symbol: string, position: Position): Promise<void> {
        console.log(`TP hit for ${symbol}`);
        
        const orderFunction = position.side === 'long' 
            ? mexcAccount.createMarketSellOrder.bind(mexcAccount)
            : mexcAccount.createMarketBuyOrder.bind(mexcAccount);
    
        const closePosition = await orderFunction(symbol, position.contracts as number);
        console.log('Close Position:', closePosition);
        this.resetSymbolFlags(symbol);
    }
    
    private async handleBreakEven(symbol: string, position: Position): Promise<void> {
        console.log(`BE hit for ${symbol}`);
    
        if (!position.entryPrice) {
            throw new Error('No entry price found for position');
        }
    
        const stopLossParams = {
            'stopPrice': position.entryPrice,
            'positionId': position.info?.positionId,
            'triggerType': 'mark_price',
            'stopType': 'full',
        };
    
        const stopLossSide = position.side === 'long' ? 'sell' : 'buy';
        const contracts = Math.abs(parseFloat(String(position.contracts)));
    
        const order = await mexcAccount.createOrder(
            position.symbol,
            'stop_limit',
            stopLossSide,
            contracts,
            position.entryPrice,
            stopLossParams
        );
    
        console.log(`Stop limit loss moved to break-even at ${position.entryPrice} for ${symbol}`);
        console.log('Order details:', order);
    }
    
    private resetSymbolFlags(symbol: string): void {
        this.symbolFlags[symbol] = {
            inTrade: false,
            long5Min: false,
            short5Min: false,
            tradeInfo: null
        };
    }
}

const port = 3000;
const server = new TradingServer(port);